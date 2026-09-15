// PREPARATION WORKSPACE — the client half of the `workspace` HUD.
//
// A text panel, not an inventory screen. Monospace, rules, tables, status
// readouts. No icons, no drag-and-drop, no rounded cards. The point is density:
// the whole working area on one screen, so the answer to "what am I actually
// doing" is a glance instead of five examines.
//
// This file holds NO game knowledge. It does not know what a pan is, what
// "raw" means, or which verb chops an onion. It renders whatever the server put
// in the payload — which is what lets a chemistry bench reuse it untouched.
//
// ── THE TWO HALVES ───────────────────────────────────────────────────────────
//
// The panel is a WORKING AREA beside a SUPPLY. Left is what is happening — the
// pans, the heat, the water, the things going round in them; right is what you
// could put into it. That split is the whole layout and it is not a decoration:
// the first draft was one flat column in which a cooling fridge, a cupboard full
// of crockery and a pan that was actively burning all had the same weight, and
// the only thing on the panel with a clock was in the middle of it.
//
// ── TICKING, AND WHY IT IS NOT DRAG AND DROP ─────────────────────────────────
//
// Combining things is the act this HUD exists for and it used to be one hover,
// one hunt and one click PER INGREDIENT, in a different row each time. Rows now
// tick, and one press puts everything ticked into a chosen pan.
//
// It is a checkbox rather than a drag because a drag cannot be done with a
// keyboard, cannot be done reliably on a touchscreen, and has no reading in the
// log rung at all. A tick is a real `<input type="checkbox">` with a real
// `<label>`, so the name is the hit target and the whole thing is operable by
// Tab and Space.
//
// ⚠ THE BATCH IS ONE COMMAND, NOT N COMMANDS. See `sendBatch`.
//
// ── WHAT MAKES THIS SAFE TO KEEP GENERIC ─────────────────────────────────────
//
// Every control below is built from a ROLE the server stamped on an action, not
// from a verb this file recognises. `heat` becomes a selector, `water` gets its
// own slot, `take`/`stow` make a row tickable. An action with no role renders as
// the chip it always did, so a new prep verb still appears the day it is
// registered and nothing here has to learn its name.
import { sendCmd, sendCmdSilent } from '../net.js';
import { makeDraggable } from './confirm.js';

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
// The rows the player has TICKED, by id — what "put these together" operates on.
// It survives a refresh (the panel re-asks after every action and on the cook
// tick), and rows that have gone are dropped, the same way a stale recipe
// highlight is: a tick against something that is no longer there would compose a
// batch command naming food nobody has.
let picked = new Set();
// id -> the row, rebuilt every render. The batch command is composed from the
// ticked rows' own names, so it needs somewhere to look them up.
let rowIndex = new Map();
// Set while a pull fired from THIS panel is in flight. `pullid` answers with a
// container_view — which is right when you typed it at a cupboard and wrong when
// you pressed "out" on a pan inside a panel that is already showing you the pan.
// One flag, consumed once, so an `open fridge` the player actually typed still
// opens the fridge.
let claimContainerView = 0;
export function workspaceClaimsContainerView() {
  if (!active || claimContainerView <= 0) return false;
  claimContainerView -= 1;
  return true;
}
// Every command this panel sends goes through here, so the claim above cannot
// drift from what was actually sent. `pullid` is the only shape that answers
// with a container view.
function panelSend(cmd) {
  if (/^pullid\s/.test(cmd)) claimContainerView += 1;
  sendCmd(cmd);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function el(id) { return document.getElementById(id); }

// Bound once, on first open. The box is never recreated — render() only rewrites
// its inner sections — so a dragged position survives every refresh, and re-opening
// the panel puts it back where the player left it rather than snapping to centre.
let dragBound = false;

export function openWorkspacePanel(data) {
  active = true;
  render(data);
  el('workspace-panel').classList.add('active');
  if (!dragBound) {
    const box = el('workspace-box'), handle = el('workspace-header');
    if (box && handle) { makeDraggable(box, handle); dragBound = true; }
    wireResize();
    wireDials();
    applyGeometry();
  }
  // A drag saves on release; this catches the one the player did before the
  // listener existed and, more usefully, the position after a move.
  el('workspace-header')?.addEventListener('pointerup', rememberGeometry, { once: false });
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
  picked = new Set();
  banksOpen = new Set();
  dialPending = new Map();
  dialDrag = null;
  claimContainerView = 0;
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  if (dialSettle) { clearTimeout(dialSettle); dialSettle = null; }
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
  // ⚠ NOT WHILE A DIAL IS BEING TURNED. The refresh re-renders the panel, which
  // replaces the SVG the pointer is captured on, and the knob dies half-turned.
  if (!live || !active || dialDrag) return;
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
function actionBtn(a, cls = '') {
  const partial = a.command.endsWith(' ');
  return `<button class="wsp-act${partial ? ' wsp-act-partial' : ''}${a.state === 'on' ? ' wsp-on' : ''}${cls ? ` ${cls}` : ''}"`
    + ` data-cmd="${esc(a.command)}"${a.state === 'on' ? ' aria-pressed="true"' : ''}`
    + ` title="${esc(a.command.trim())}${a.hint ? ` — ${esc(a.hint)}` : ''}">${esc(a.label)}</button>`;
}

function actionStrip(actions) {
  if (!(actions || []).length) return '';
  return `<span class="wsp-acts">` + actions.map(a => actionBtn(a)).join('') + `</span>`;
}

// Split an action list by role. `rest` keeps declaration order and keeps
// everything this file has no opinion about, which is what stops an unknown role
// from vanishing off the panel.
function byRole(actions, ...roles) {
  const want = new Set(roles);
  const taken = [], rest = [];
  for (const a of actions || []) (want.has(a.role) ? taken : rest).push(a);
  return { taken, rest };
}

// ── "PREP IT…" AND "COOK IT…" — two controls, one mechanism ─────────────────
//
// The server sends each of these as an ordinary roled action carrying a literal
// command (`mince rat haunch`, `fry rat haunch`). They could render as a strip
// of chips and that is what the first cut did: a rat haunch came out with eleven
// buttons on it, and the five that cost you something permanent looked exactly
// like the four that start dinner.
//
// So each ROLE collapses behind one chip, and a food row becomes two questions
// instead of eleven answers: what do you want to do to it, and how do you want
// to cook it. This is PRESENTATION ONLY and has to stay that way — the actions
// are in the payload either way, both lower Display Mode rungs print them flat
// as the links they already were, and nothing here knows what any of the words
// mean. Collapsing a role is the same move the heat selector already makes.
//
// ⚠ A BANK COLLAPSES EVEN WHEN IT HOLDS ONE THING. Dry starch has exactly one
// method (`boil`) and an onion one prep (`chop`), and showing those inline while
// their neighbours collapse would mean no two rows in the column had the same
// shape — which is the scanning problem this was built to fix, reintroduced for
// the sake of one saved click.
//
// Which banks are open is module state rather than a DOM `<details>`, because
// render() rewrites the body on every action and on the cook tick, and a
// disclosure that snapped shut every five seconds while a pan was on the heat
// would be worse than no disclosure at all.
let banksOpen = new Set();

// ⚠ KEYED ON THE STRING FORM, ALWAYS. Inventory row ids arrive as numbers and
// vessel ids as strings, both land in this one Set, and a DOM attribute can only
// ever give the string back — so keying on the raw value means a pan's
// disclosure records `"v1"` and is then asked about `v1`, and the answer is no.
// It opens, the re-render closes it, and it reads as a dead button.
const bkey = (kind, id) => `${kind}:${id}`;

// The two banks, and the only thing this file knows about either: what to call
// it. Neither entry names a verb.
const BANKS = {
  prep: { label: 'prep it', title: 'what to do to it first', cls: 'wsp-bank-prep' },
  method: { label: 'cook it', title: 'how to cook it', cls: 'wsp-bank-cook' },
};

function disclosure(kind, rowId, actions) {
  if (!(actions || []).length) return '';
  const spec = BANKS[kind];
  const key = bkey(kind, rowId);
  const open = banksOpen.has(key);
  const id = `wsp-b-${esc(key)}`;
  return `<span class="wsp-disc ${spec.cls}${open ? ' wsp-disc-open' : ''}">`
    + `<button class="wsp-act wsp-disc-toggle" data-bank="${esc(key)}"`
    + ` aria-expanded="${open}" aria-controls="${id}"`
    + ` title="${esc(spec.title)} — ${esc(actions.map(a => a.label).join(', '))}">`
    + `${esc(spec.label)}${open ? ' ▾' : '…'}</button>`
    + `<span class="wsp-disc-list" id="${id}"${open ? '' : ' hidden'}>`
    + actions.map(a => actionBtn(a, 'wsp-disc-item')).join('')
    + `</span></span>`;
}

// A LABELLED BANK OF CONTROLS on a station — `HEAT low [MID] high`.
//
// The label is what turns three chips into one control: without it the heat trio
// read as three more buttons in a row of eight, and nothing said which of them
// you were already on. `role="group"` so a screen reader announces it the same
// way.
function controlBank(label, actions) {
  if (!(actions || []).length) return '';
  return `<div class="wsp-bank" role="group" aria-label="${esc(label)}">`
    + `<span class="wsp-bank-label">${esc(label)}</span>`
    + actions.map(a => actionBtn(a, 'wsp-seg')).join('')
    + `</div>`;
}

// The cook meter. PIPS, not a bar and never a countdown: `stage` is which beat
// of the prose the food is on, and the server deliberately knows nothing finer —
// deciding when to plate is the largest quality lever in the kitchen, and a
// percentage would hand that half of the game over. Past the finish there is no
// beat to count towards, so the window says so in a word instead.
function cookMeter(cook) {
  if (!cook) return '';
  // The pan's own state, ahead of the beat count: a pot about to run dry is a
  // more urgent fact than which stage its contents are on, and the one thing the
  // player can still do something about.
  if (cook.dry) return `<span class="wsp-burnt">BOILED DRY</span>`;
  // A ring turned off is a pan sitting there not cooking, and the pips would be
  // right and would say nothing about the one fact that matters — they would
  // simply stop moving, which looks exactly like a slow cook.
  if (cook.phase === 'paused') return `<span class="wsp-paused">OFF THE HEAT</span>`;
  if (cook.phase === 'window') return `<span class="wsp-window">READY — plate it</span>`;
  if (cook.phase === 'over') return `<span class="wsp-over">PAST IT</span>`;
  if (cook.phase === 'burnt') return `<span class="wsp-burnt">BURNING</span>`;
  if (!cook.stages) return '';
  const pips = Array.from({ length: cook.stages }, (_, i) => (i < cook.stage ? '●' : '○')).join('');
  const water = cook.water
    ? ` <span class="wsp-water${/low|gone/.test(cook.water) ? ' wsp-water-low' : ''}">water ${esc(cook.water)}</span>`
    : '';
  return `<span class="wsp-pips${cook.phase === 'thaw' ? ' wsp-thaw' : ''}">${pips}</span>${water}`;
}

// A row is TICKABLE when the server offered a way to MOVE it — take it out of a
// box, or put it into a vessel. That is the whole test, and it is deliberately a
// question about the payload rather than about food: a chemistry bench whose
// reagents can be taken and stowed gets the tick for free, and a pan already on
// the heat never gets one because there is nowhere left to put it.
const canPick = (c) => (c.actions || []).some(a => a.role === 'take' || a.role === 'stow');

// Set per render: does any station offer to take a handful of ticked rows?
// While it does, the per-row `→ skillet` / `→ saucepan` chips are NOT drawn.
//
// They were one chip PER PAN PER ROW — a two-pan kitchen put two of them on
// every raw ingredient, and they were what made a row wrap onto a second line —
// and the tick does strictly more than they did: it works for one thing or six,
// and it works on something still in the fridge, which `stow` cannot even reach.
//
// ⚠ THEY STAY IN THE PAYLOAD. They are what makes a row tickable at all (see
// `canPick`), they carry the vessel id, and the LOG rung still prints them as
// links — down there nothing ticks, so they are the only way to load a pan.
// This hides a chip; it does not remove an action.
let hasBatch = false;
const shownActions = (c) => (hasBatch ? (c.actions || []).filter(a => a.role !== 'stow') : c.actions);

// Set per render: is there a drawn dial bank on screen? While there is, a
// station's own heat trio is not drawn — see renderStation.
let hasDials = false;

// ── A ROW'S ACTIONS, IN THE ORDER A COOK THINKS ─────────────────────────────
//
// One flat strip was fine when a raw ingredient had two chips on it. With the
// methods in the payload a rat haunch carries eleven, and a flat strip of eleven
// says nothing about the fact that `mince` takes two rungs off the ceiling
// FOREVER while `fry` just starts dinner. They looked identical because they
// were rendered identically.
//
// So a row that can be PREPARED is laid out in the order you'd do it —
// prep, then how to cook it, then where to put it — and everything else keeps
// the plain strip it always had. That test is deliberately about the payload
// rather than about food: a chemistry bench whose reagents grow prep verbs gets
// the same layout for free, and a row you can only `take` never sprouts banks
// it has no use for.
//
// ⚠ `rest` is what keeps this safe. Anything with a role this file has never
// heard of comes out the far end in declaration order, exactly as before — the
// same guarantee `byRole` was written for. A new verb still appears the day it
// is registered.
function rowActions(c) {
  const all = shownActions(c) || [];
  const prep = byRole(all, 'prep');
  const method = byRole(prep.rest, 'method');
  const stow = byRole(method.rest, 'stow');
  if (!prep.taken.length && !method.taken.length) return actionStrip(all);

  return `<span class="wsp-acts wsp-acts-grouped">`
    + disclosure('prep', c.id, prep.taken)
    + disclosure('method', c.id, method.taken)
    + (stow.taken.length ? `<span class="wsp-mini" role="group" aria-label="Put it in">`
        + `<span class="wsp-mini-label">into</span>${stow.taken.map(a => actionBtn(a)).join('')}</span>` : '')
    + stow.rest.map(a => actionBtn(a)).join('')
    + `</span>`;
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
  // A tickable row gets a real checkbox and a real label, so the NAME is the hit
  // target and Tab/Space reach it. An untickable one keeps the plain span it
  // always had — a disabled checkbox on every line in a pan would be a column of
  // dead controls saying nothing.
  const tick = canPick(c)
    ? `<input type="checkbox" class="wsp-tick" id="wsp-pick-${esc(c.id)}" data-pick="${esc(c.id)}"${picked.has(c.id) ? ' checked' : ''}>`
    : '';
  const name = canPick(c)
    ? `<label class="wsp-name" for="wsp-pick-${esc(c.id)}">${esc(c.name)}</label>`
    : `<span class="wsp-name">${esc(c.name)}</span>`;
  return `<div class="wsp-row${c.live ? ' wsp-live' : ''}${by ? ' wsp-wanted' : ''}${picked.has(c.id) ? ' wsp-picked' : ''}"`
    + ` style="padding-left:${indent * 14}px">`
    + `${mark}${tick}${name}${qty}${state}${meter}${notes}`
    + rowActions(c) + `</div>`;
}

function section(label, bodyHtml, emptyText) {
  return `<div class="wsp-section">`
    + `<div class="wsp-rule"><span class="wsp-label">${esc(label)}</span></div>`
    + (bodyHtml || `<div class="wsp-row wsp-empty">${esc(emptyText)}</div>`)
    + `</div>`;
}

// ONE STATION — a pan, or a ring with nothing on it.
//
// A bordered block rather than a row, because a pan is the thing this panel is
// about and a row is what everything else is. Inside, the controls come FIRST
// and the contents second: what you are about to do to the pan is the decision,
// and what is in it is the evidence for it.
//
// The control banks are built from roles, so this function names no verb. What
// it does know is the ORDER a cook thinks in — heat, then water, then everything
// else — and that ordering is the only opinion in it.
function renderStation(v) {
  // ⚠ FILTERED OUT, not moved to `rest`. `rest` is what keeps an unknown role
  // on the panel, so anything dropped into it is still drawn — the trio came back
  // as three bare chips at the foot of the pan, which is the duplicate control
  // this was meant to remove wearing a worse hat.
  const heatBank = hasDials
    ? { taken: [], rest: (v.actions || []).filter(a => a.role !== 'heat') }
    : byRole(v.actions, 'heat');
  const waterBank = byRole(heatBank.rest, 'water');
  // The badge is the FALLBACK, not a companion to the selector. Where there is a
  // selector it already shows which ring is lit, and printing "burner mid" beside
  // a highlighted MID is the same fact twice — which reads as two settings.
  const heat = (v.heat && !heatBank.taken.length && !hasDials)
    ? `<span class="wsp-heat">burner ${esc(v.heat)}</span>` : '';
  const head = `<div class="wsp-row wsp-vessel${v.hot ? ' wsp-hot' : ''}${v.idle ? ' wsp-idle' : ''}">`
    + `<span class="wsp-name">${esc(v.name)}</span>`
    + `<span class="wsp-state"> — ${esc(v.place)}</span> ${heat}</div>`;

  // A free burner is a place to put a pan, not a container: it has no inside, so
  // it gets no "empty" line, no controls and no bank. The row IS the whole
  // statement.
  if (v.idle) return `<div class="wsp-station wsp-station-idle">${head}</div>`;

  const controls = controlBank('Heat', heatBank.taken) + controlBank('Water', waterBank.taken);

  const inner = (v.contents || []).length
    ? v.contents.map(c => componentLine(c, 1)).join('')
    : `<div class="wsp-row wsp-empty" style="padding-left:14px">empty</div>`;

  // What is left over — cook, plate, taste, deglaze, scour, and anything with a
  // role this file has never heard of. It sits under the contents because every
  // one of them is a judgement about what is in the pan.
  //
  // The methods collapse here too. A loaded pan offers its own KIND's methods
  // (`boil stock pot`, `bake roasting tray`), which is the same sentence the
  // verb already understands — naming a vessel is the instruction. Before this
  // the only thing a cold loaded pan offered was a bare `cook`.
  const methodsHere = byRole(waterBank.rest, 'method');
  const foot = (methodsHere.taken.length || methodsHere.rest.length)
    ? `<div class="wsp-row wsp-vessel-foot">`
      + `<span class="wsp-acts">${disclosure('method', v.id, methodsHere.taken)}`
      + methodsHere.rest.map(a => actionBtn(a)).join('') + `</span></div>`
    : '';

  // "Put the ticked things in THIS one." Only while something is ticked — an
  // always-present button would be a control that does nothing most of the time.
  const drop = (v.batch && picked.size)
    ? `<div class="wsp-row wsp-drop"><button class="wsp-act wsp-drop-btn" data-batch="${esc(v.id)}"`
      + ` title="${esc(v.batch.hint || v.batch.label)}">${esc(v.batch.label)} (${picked.size})</button></div>`
    : '';

  return `<div class="wsp-station${v.hot ? ' wsp-station-hot' : ''}">`
    + head + controls + inner + foot + drop + `</div>`;
}

function renderArea(area) {
  if (!area.length) return '';
  return area.map(renderStation).join('');
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
      // ORDER OF READING: the name, then the one thing you'd do about it, then
      // the measurement, then the button.
      //
      // It used to be name, band, bar, percentage, THEN "need butter" — so the
      // only actionable words on the row came fifth, behind a ten-character
      // green block that is the loudest thing in the panel and says the least.
      // A completion percentage is a progress readout: worth having, worth
      // glancing at, never worth reading first. It is pushed right into its own
      // quiet column so a column of recipes reads as a list of NAMES with a list
      // of REASONS beside them, which is the scan you actually do.
      const head = `<div class="wsp-row wsp-recipe${open ? ' wsp-open' : ''}" data-recipe="${esc(r.key)}">`
        + `${ord}<span class="wsp-name">${esc(r.name)}</span>`
        + `<span class="wsp-state"> — ${need}</span>`
        + `<span class="wsp-recipe-gauge">`
        + (r.band ? `<span class="wsp-note">${esc(r.band)}</span>` : '')
        + `${bar(r.pct)}<span class="wsp-qty">${r.pct}%</span></span>`
        // ⚠ ALWAYS the lane, even with nothing in it. A recipe short of a tray
        // has no action worth offering, so `actionStrip` returned an empty
        // string and that row's gauge slid right by the width of a button the
        // other rows had — three recipes, three different right edges, which is
        // exactly what moving the gauge right was meant to stop.
        + `<span class="wsp-acts">${(r.actions || []).map(a => actionBtn(a)).join('')}</span></div>`;
      if (!open) return head;

      // WHAT THE RECIPE IS lives in its own section (see `renderRecipeCard`) —
      // ingredients, kit and method are a CARD you read, and they were burying
      // the two things the Assistant is for underneath them. What stays here is
      // what you're short of and what to press next.
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
      // THE RUNBOOK. The method — over in the recipe card — says what to do; this
      // says what to type, against the actual rows in this room.
      //
      // THE WHOLE LINE IS THE BUTTON. Every step carries a real command in
      // `data-cmd`, dispatched through the same pipeline a typed one goes
      // through, and pressing the sentence rather than hunting a chip at the end
      // of it is the difference between a list with buttons on it and a thing you
      // can walk straight down. The command still rides along on the right,
      // because teaching the verb is the entire point of this panel. A step with
      // no command (there is no verb for "leave it alone") stays prose and is
      // deliberately not pressable.
      if ((r.walkthrough || []).length) {
        body.push(`<div class="wsp-row wsp-step"> </div>`);
        body.push(`<div class="wsp-row wsp-step wsp-mark-note">Step by step — press one at a time, and judge the heat yourself.</div>`);
        (r.walkthrough || []).forEach((s, i) => {
          const hint = s.hint ? `<span class="wsp-note"> · ${esc(s.hint)}</span>` : '';
          if (!s.command) {
            body.push(`<div class="wsp-row wsp-step wsp-run-idle"><span class="wsp-run-n">${i + 1}.</span> ${esc(s.text)}${hint}</div>`);
            return;
          }
          // Not `.wsp-act` — that class is the small chip at the end of a row and
          // its uppercase 10px border would undo the whole point of a full-width
          // step. It carries `data-cmd` and the click handler takes both.
          body.push(`<button type="button" class="wsp-row wsp-step wsp-run" data-cmd="${esc(s.command)}"`
            + ` title="${esc(s.command)}${s.hint ? ` — ${esc(s.hint)}` : ''}">`
            + `<span class="wsp-run-n">${i + 1}.</span> ${esc(s.text)}${hint}`
            + `<span class="wsp-run-cmd">${esc(s.command)}</span></button>`);
        });
      }
      if (wanted.size) {
        body.push(`<div class="wsp-row wsp-step wsp-mark-note">▸ marks what it would use, wherever it is${selected.size > 1 ? ` — numbered by recipe, so ▸${ordinals.get(r.key)} is this one` : ''}.</div>`);
      }
      return head + body.join('');
    }).join('')
  ).join('');
  const note = a.note ? `<div class="wsp-row wsp-empty">${esc(a.note)}</div>` : '';
  return rows + note;
}

// THE RECIPE, as its own section.
//
// What a dish IS — what goes in it, what it's made in, how it's made — is a card
// you read, and it does not belong inside a list of everything you could cook.
// It used to unfold in place under the Assistant row, which pushed the two lines
// that are actually about YOUR kitchen (what you're short of, what to press next)
// off the bottom behind a dozen lines of catalog. So they split: the Assistant
// keeps the judgement, this keeps the recipe.
//
// One section per open recipe, in the order they were opened — the same order
// the ▸1/▸2 markers are numbered in, so a card can be matched to its marks.
// THE CARD — what the dish IS, as opposed to what you're short of (that's the
// Assistant's open body) or what to type (that's the runbook under it).
//
// It used to be ten rows of `.wsp-step` in a single column: three ingredients, a
// couple of bits of kit and four numbered steps, all the same dim grey, all the
// same indent, with a blank row doing the work of a heading. Nothing said where
// the ingredients stopped and the pans started, and the two lists were marked
// with the same `·` while meaning different things — an ingredient you need
// versus a spoon you'd merely like.
//
// So: three named parts, and the two SHORT lists side by side. The card runs the
// full width under both columns (a recipe is prose and reads badly in a half
// column), and that width was going spare — ingredients and kit are each three
// or four lines, so stacking them pushed the method below the fold for nothing.
// The method stays full width, because it is sentences.
function cardPart(label, rowsHtml) {
  if (!rowsHtml) return '';
  return `<div class="wsp-card-part">`
    + `<div class="wsp-card-head">${esc(label)}</div>${rowsHtml}</div>`;
}

function renderRecipeCard(r) {
  const ingredients = (r.ingredients || [])
    .map(line => `<div class="wsp-row wsp-step">· ${esc(line)}</div>`).join('');

  // What it's made IN, ticked against the room — the same question the
  // ingredients answer, asked of the cupboard instead of the fridge.
  //
  // ⚠ THREE MARKS, THREE MEANINGS, AND THE THIRD ONE IS NOT A FAILURE. A missing
  // REQUIRED pan refuses the dish; a missing spoon makes it worse and nothing
  // else. Printing both as `·` (which is what happened) meant the card gave the
  // same answer to "can I make this" and "will it be as good as it could be".
  const kit = (r.kit || []).map(g => {
    const mark = g.held ? '✓' : (g.req === 'required' ? '✗' : '·');
    const cls = g.held ? 'wsp-kit-held' : (g.req === 'required' ? 'wsp-kit-short' : 'wsp-kit-soft');
    const note = (!g.held && g.req !== 'required')
      ? `<span class="wsp-note"> — better with, works without</span>` : '';
    return `<div class="wsp-row wsp-step ${cls}"><span class="wsp-kit-mark">${mark}</span> ${esc(g.label)}${note}</div>`;
  }).join('');

  // Deliberately NOT escaped: the method comes from the server's own catalog and
  // may carry a <b> around the verb it wants you to type.
  const method = (r.method || [])
    .map((line, i) => `<div class="wsp-row wsp-step"><span class="wsp-run-n">${i + 1}.</span> ${line}</div>`)
    .join('');

  const top = cardPart('Ingredients', ingredients) + cardPart('Made in', kit);
  return (top ? `<div class="wsp-card-cols">${top}</div>` : '')
    + cardPart('Method', method);
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

// ── Ticking, and the tray it fills ───────────────────────────────────────────

// Rebuild id -> row, and drop ticks that no longer mean anything. A row that has
// gone into a pan stops being tickable (there is nowhere left to put it), so a
// successful batch unticks exactly what it moved and leaves behind whatever it
// could not — which is the right thing to still have ticked.
function indexRows(data) {
  rowIndex = new Map();
  const eat = (list) => { for (const c of list || []) if (c && c.id != null) rowIndex.set(c.id, c); };
  eat(data?.components);
  eat(data?.tools);
  for (const v of data?.area || []) eat(v.contents);
  for (const s of data?.storage || []) eat(s.items);
  for (const id of [...picked]) {
    const r = rowIndex.get(id);
    if (!r || !canPick(r)) picked.delete(id);
  }
}

// THE TRAY — what is ticked, and the one press that acts on all of it.
//
// It lives outside the scrolling body on purpose. A player ticks four things in
// the fridge, scrolls up to the pans, and the whole point is that the button is
// still there when they arrive.
function renderTray(data) {
  if (!picked.size) return '';
  const rows = [...picked].map(id => rowIndex.get(id)).filter(Boolean);
  if (!rows.length) return '';
  const takeable = rows.filter(r => (r.actions || []).some(a => a.role === 'take'));
  const btns = [];
  // Only when some of them are still in a box. Once everything ticked is in your
  // hands the button has nothing to do, and a dead control beside a live one is
  // worse than no control.
  if (takeable.length) {
    btns.push(`<button class="wsp-act" id="wsp-tray-take" title="take them out, and leave them ticked">`
      + `take ${takeable.length}</button>`);
  }
  for (const v of (data.area || [])) {
    if (!v.batch || v.idle) continue;
    btns.push(`<button class="wsp-act wsp-drop-btn" data-batch="${esc(v.id)}"`
      + ` title="${esc(v.batch.hint || v.batch.label)}">${esc(v.batch.label)}</button>`);
  }
  btns.push(`<button class="wsp-act" id="wsp-tray-clear" title="untick everything">clear</button>`);
  return `<div class="wsp-tray-in">`
    + `<span class="wsp-tray-count">${rows.length} ticked</span>`
    + `<span class="wsp-tray-names">${esc(rows.map(r => r.name).join(', '))}</span>`
    + `<span class="wsp-tray-acts">${btns.join('')}</span></div>`;
}

// ── THE HOB ──────────────────────────────────────────────────────────────────
//
// The one part of this panel that is not text, and the exception is argued
// rather than assumed. Everything else here is a list, and a list is the right
// shape for a list. A burner is not a list: it is one continuous quantity with a
// marked safe zone, which is exactly what a dial is for and exactly what three
// chips in a row cannot show. 'low  MID  high' said which of three you were on
// and nothing at all about how much room there was either side of it.
//
// It still holds no game knowledge. The server sends eleven positions, each
// carrying a literal command, plus which one is lit, where the ceiling is and
// which band the food currently wants. This file draws that; it does not know
// what a burner is, that 7 is hotter than 2, or what the green band means.
//
// ⚠ ONE COMMAND PER SETTLE, NOT ONE PER PIXEL. A drag crosses eight positions on
// the way to the ninth. Sending each would spend the connection's whole rate
// limit, interleave eight session rewrites on the server and narrate eight
// burner changes into the log for one turn of a knob. So the drag moves a LOCAL
// number and the command goes on release.
//
// ⚠ AND THE PANEL MUST NOT REBUILD UNDER A FINGER. render() rewrites its
// sections wholesale and the cook tick calls it every five seconds; replacing
// the SVG mid-drag drops the pointer capture and the dial dies half-turned. The
// tick is suppressed while dragging, and a move repaints the live node in place
// rather than going back through render().
const DIAL_R = 34, DIAL_CX = 50, DIAL_CY = 52, DIAL_START = 135, DIAL_SWEEP = 270;

// id -> the level the player has dialled but the server has not confirmed. It
// wins over the payload while it exists, which is what makes the knob feel
// attached to the finger; a rejected setting (above this stove's ceiling) is
// dropped after a beat and the dial snaps back, with the refusal in the feed
// directly beside it.
let dialPending = new Map();
let dialDrag = null;
let dialSettle = null;

const dialPt = (level, max, r) => {
  const a = (DIAL_START + (max ? level / max : 0) * DIAL_SWEEP) * Math.PI / 180;
  return [DIAL_CX + r * Math.cos(a), DIAL_CY + r * Math.sin(a)];
};

// An arc between two LEVELS rather than between two angles — every caller here
// is talking about positions on the dial, and converting in one place is what
// stops the band and the needle disagreeing about where 7 is.
function dialArc(from, to, max, r) {
  const [x0, y0] = dialPt(from, max, r);
  const [x1, y1] = dialPt(to, max, r);
  const large = ((to - from) / (max || 1)) * DIAL_SWEEP > 180 ? 1 : 0;
  return 'M ' + x0.toFixed(2) + ' ' + y0.toFixed(2)
    + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
}

function dialSvg(b, level) {
  const max = b.max;
  const band = b.want ? (b.notches || []).find(n => n.name === b.want) : null;
  const [px, py] = dialPt(level, max, DIAL_R - 4);
  const [ix, iy] = dialPt(level, max, 12);
  const parts = [];
  // The comfy band rides OUTSIDE the track, so the lit arc can never cover it.
  if (band) parts.push('<path class="wsp-dial-band" d="' + dialArc(Math.max(0, band.from - 0.5), Math.min(max, band.to + 0.5), max, DIAL_R + 7) + '"/>');
  parts.push('<path class="wsp-dial-track" d="' + dialArc(0, max, max, DIAL_R) + '"/>');
  // Above this stove's ceiling: there, and visibly not available. A dial whose
  // unreachable half simply isn't drawn reads as a smaller dial, and then the
  // refusal when you turn it up looks like a bug.
  if (b.ceiling < max) parts.push('<path class="wsp-dial-over" d="' + dialArc(b.ceiling, max, max, DIAL_R) + '"/>');
  if (level > 0) parts.push('<path class="wsp-dial-lit" d="' + dialArc(0, level, max, DIAL_R) + '"/>');
  for (const n of b.notches || []) {
    const [ax, ay] = dialPt(n.level, max, DIAL_R + 14);
    parts.push('<text class="wsp-dial-notch" font-size="8" x="' + ax.toFixed(1) + '" y="' + (ay + 3).toFixed(1) + '">'
      + esc(String(n.name || '?').charAt(0).toUpperCase()) + '</text>');
  }
  parts.push('<line class="wsp-dial-needle" x1="' + ix.toFixed(2) + '" y1="' + iy.toFixed(2)
    + '" x2="' + px.toFixed(2) + '" y2="' + py.toFixed(2) + '"/>');
  parts.push('<circle class="wsp-dial-hub" cx="' + DIAL_CX + '" cy="' + DIAL_CY + '" r="11"/>');
  parts.push('<text class="wsp-dial-read" font-size="13" x="' + DIAL_CX + '" y="' + (DIAL_CY + 4) + '">' + level + '</text>');
  return '<svg class="wsp-dial' + (level === 0 ? ' wsp-dial-off' : '') + '" viewBox="0 0 100 104"'
    + ' role="slider" tabindex="0" data-burner="' + esc(b.id) + '"'
    + ' aria-label="' + esc(b.name) + ' burner"'
    + ' aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + level + '"'
    + ' aria-valuetext="' + esc(level + ' of ' + max + ', ' + (b.label || '')) + '">'
    + parts.join('') + '</svg>';
}

function renderDials(dials) {
  if (!(dials || []).length) return '';
  return '<div class="wsp-dials">' + dials.map(b => {
    const level = dialPending.has(b.id) ? dialPending.get(b.id) : b.level;
    const on = b.levels.find(l => l.level === level) || b.levels[0];
    // WHAT IT WANTS, IN WORDS AND A DIRECTION. The band on the dial is the
    // picture; this is the sentence, because a colour alone is not a reading and
    // is not available to everybody looking at it.
    //
    // ⚠ THE WORDS ARE THE SERVER'S, INCLUDING "IT IS OFF". This file is the one
    // part of the feature not allowed any domain vocabulary, so a dead dial's
    // sentence arrives as a verdict rather than being composed here.
    const v = b.verdict
      ? '<div class="wsp-dialrow-want wsp-want-' + esc(b.verdict.state) + '">' + esc(b.verdict.text) + '</div>'
      : '';
    const subj = b.subject
      ? '<div class="wsp-dialrow-subject' + (b.idle ? ' wsp-paused' : '') + '">' + esc(b.subject) + '</div>'
      : '<div class="wsp-dialrow-subject wsp-empty">nothing on it</div>';
    const meter = b.meter ? '<div class="wsp-dialrow-meter">' + cookMeter(b.meter) + '</div>' : '';
    const notchBtns = (b.notches || []).map(n => {
      const l = b.levels.find(x => x.level === n.level);
      if (!l || l.over) return '';
      return '<button class="wsp-act' + (l.level === level ? ' wsp-on' : '') + '" data-cmd="' + esc(l.command)
        + '" title="' + esc(l.command) + '">' + esc(n.name) + '</button>';
    }).join('');
    return '<div class="wsp-dialrow' + (level > 0 && b.subject ? ' wsp-dialrow-live' : '') + '">'
      + dialSvg(b, level)
      + '<div class="wsp-dialrow-side">'
      + '<div class="wsp-dialrow-name">' + esc(b.name) + '</div>'
      + '<div class="wsp-dialrow-label">' + esc(b.label || '')
      + (b.band ? ' <span class="wsp-qty">' + esc(b.band) + '</span>' : '') + '</div>'
      + subj + meter + v
      + '<div class="wsp-dialrow-cmds">'
      + '<button class="wsp-act' + (level === 0 ? ' wsp-on' : '') + '" data-cmd="' + esc(b.levels[0].command)
      + '" title="' + esc(b.levels[0].command) + '">off</button>' + notchBtns
      + '</div>'
      // The literal command for wherever the knob is now. This panel teaches the
      // verb — the dial is a faster way to say it, never a replacement for
      // knowing it can be said.
      + '<div class="wsp-dialrow-cmd">' + esc(on.command) + '</div>'
      + '</div></div>';
  }).join('') + '</div>';
}

// Where on the dial a pointer is, as a level. Pure geometry against the SVG's
// own box, so it is right at any rendered size.
function levelFromPointer(svg, e, max) {
  const r = svg.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 100 - DIAL_CX;
  const y = ((e.clientY - r.top) / r.height) * 104 - DIAL_CY;
  let a = Math.atan2(y, x) * 180 / Math.PI;
  if (a < 0) a += 360;
  if (a < DIAL_START) a += 360;                // the gap at the bottom of the arc
  const t = Math.max(0, Math.min(1, (a - DIAL_START) / DIAL_SWEEP));
  return Math.round(t * max);
}

const dialById = (id) => (lastData?.dials || []).find(b => String(b.id) === String(id)) || null;

// Paint a pending level straight onto the live SVG. Deliberately not a
// re-render: render() rebuilds the whole panel, and doing that per pointermove
// would be both wasteful and the thing that drops the pointer capture.
function repaintDial(svg, b, level) {
  const fresh = new DOMParser().parseFromString(dialSvg(b, level), 'image/svg+xml').documentElement;
  svg.innerHTML = fresh.innerHTML;
  svg.setAttribute('aria-valuenow', String(level));
  svg.setAttribute('aria-valuetext', level + ' of ' + b.max);
  svg.classList.toggle('wsp-dial-off', level === 0);
  const row = svg.closest('.wsp-dialrow');
  const l = b.levels.find(x => x.level === level);
  if (!row || !l) return;
  const cmd = row.querySelector('.wsp-dialrow-cmd');
  if (cmd) cmd.textContent = l.command;
  // The words for wherever the knob is now — the server's, never ours. Without
  // this the number and the command follow the finger and the prose beside them
  // goes on describing the setting the player has just left.
  const text = row.querySelector('.wsp-dialrow-label');
  if (text) text.innerHTML = esc(l.label || '') + (l.band ? ' <span class="wsp-qty">' + esc(l.band) + '</span>' : '');
}

// The command for where the knob ended up. Sent once, on settle.
function commitDial(id) {
  const b = dialById(id);
  if (!b) { dialPending.delete(id); return; }
  const level = dialPending.get(id);
  if (level === undefined || level === b.level) { dialPending.delete(id); return; }
  const l = b.levels.find(x => x.level === level);
  if (!l) { dialPending.delete(id); return; }
  runAction(l.command);
  // ⚠ DROP THE OPTIMISTIC VALUE AFTER A BEAT, WHATEVER HAPPENED. A setting above
  // this stove's ceiling is refused, and a pending level nothing ever clears
  // would leave the dial permanently showing a position the control is not at.
  clearTimeout(dialSettle);
  dialSettle = setTimeout(() => { dialPending.delete(id); if (lastData) render(lastData); }, 1600);
}

function wireDials() {
  const host = el('workspace-dials');
  if (!host) return;
  host.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest('.wsp-dial');
    if (!svg) return;
    const id = svg.getAttribute('data-burner');
    const b = dialById(id);
    if (!b) return;
    dialDrag = id;
    // Capture keeps the knob under the finger once the pointer leaves the SVG,
    // which is most of a drag. It can legitimately fail (a synthetic event, a
    // pointer the browser has already released) and losing it is a worse drag,
    // never a broken one — so it must not take the handler down with it.
    try { svg.setPointerCapture(e.pointerId); } catch { /* drag still tracks while the pointer is over the dial */ }
    const lv = Math.min(levelFromPointer(svg, e, b.max), b.ceiling);
    dialPending.set(id, lv);
    repaintDial(svg, b, lv);
    e.preventDefault();
  });
  host.addEventListener('pointermove', (e) => {
    if (!dialDrag) return;
    const svg = host.querySelector('.wsp-dial[data-burner="' + CSS.escape(dialDrag) + '"]');
    const b = dialById(dialDrag);
    if (!svg || !b) return;
    const lv = Math.min(levelFromPointer(svg, e, b.max), b.ceiling);
    if (dialPending.get(dialDrag) === lv) return;
    dialPending.set(dialDrag, lv);
    repaintDial(svg, b, lv);
  });
  const release = () => { if (!dialDrag) return; const id = dialDrag; dialDrag = null; commitDial(id); };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
  // Keyboard reaches the same positions. A dial that can only be dragged is a
  // control that half the people who need it cannot use at all.
  host.addEventListener('keydown', (e) => {
    const svg = e.target.closest('.wsp-dial');
    if (!svg) return;
    const id = svg.getAttribute('data-burner');
    const b = dialById(id);
    if (!b) return;
    const at = dialPending.has(id) ? dialPending.get(id) : b.level;
    let next = at;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = at + 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = at - 1;
    else if (e.key === 'PageUp') next = at + 3;
    else if (e.key === 'PageDown') next = at - 3;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = b.ceiling;
    else if (/^[0-9]$/.test(e.key)) next = parseInt(e.key, 10);
    else return;
    e.preventDefault();
    e.stopPropagation();
    next = Math.max(0, Math.min(b.ceiling, next));
    dialPending.set(id, next);
    repaintDial(svg, b, next);
    clearTimeout(dialSettle);
    dialSettle = setTimeout(() => commitDial(id), 500);
  });
}

// ── The ribbon ───────────────────────────────────────────────────────────────
//
// Four beats, and which one the job is on. Purely a reading of the payload — it
// gates nothing, and the hint under it is the server's sentence rather than one
// composed here.
function renderStages(s) {
  if (!s) return '';
  const steps = s.steps.map((st, i) =>
    '<span class="wsp-stage wsp-stage-' + esc(st.state) + '">'
    + '<span class="wsp-stage-n">' + (i + 1) + '</span>' + esc(st.label) + '</span>')
    .join('<span class="wsp-stage-sep">›</span>');
  return '<div class="wsp-stages">' + steps
    + '<span class="wsp-stage-hint">' + esc(s.hint || '') + '</span></div>';
}
// ── THE FEED — the game's own replies, inside the panel covering them ────────
//
// This panel is a screenful. While it is open it sits on top of the log, and the
// log is where every answer the kitchen gives arrives: the refusals, the burner
// line, "the pan is already going", the stage narration that tells you a thing
// is browning. A HUD you have to close to read the reply to the button you just
// pressed in it makes the game harder to read, not easier.
//
// ⚠ IT OBSERVES THE LOG. It does not hook appendMsg/appendHtml/appendPre, for
// exactly the reason the log reader doesn't: the log rung's promise is "if a
// system's record doesn't reach the log, that rung isn't done for it", so
// watching the LOG catches every line however it got there — including panels
// that append directly, and including the fourth append helper somebody adds
// next year.
//
// ⚠ AND IT MIRRORS, IT DOES NOT MOVE. The line is still in #output, still in the
// transcript, still read aloud, still routed to whatever pane a rule sends it
// to. This is a copy in a second place, which is why it can be this simple:
// nothing downstream of the log has to know it exists.
//
// A gagged line is never mounted in #output at all, so it never reaches here —
// which is right. Gagging is a statement about not wanting to read something,
// and opening a panel should not undo it.
const FEED_MAX = 120;
let feedBound = false;

function feedPush(node) {
  const host = el('workspace-feed');
  if (!host) return;
  // A clone keeps the classes and the markup, so a dim aside stays dim and a
  // command echo still reads as an echo. Cheap — these are small nodes.
  host.appendChild(node.cloneNode(true));
  while (host.childElementCount > FEED_MAX) host.removeChild(host.firstElementChild);
  host.scrollTop = host.scrollHeight;
}

function initFeed() {
  if (feedBound) return;
  const out = document.getElementById('output');
  if (!out) return;
  feedBound = true;
  new MutationObserver((records) => {
    if (!active) return;
    for (const rec of records) {
      for (const node of rec.addedNodes) if (node.nodeType === 1) feedPush(node);
    }
  }).observe(out, { childList: true });
}

// ── Geometry — where the window is, and how big ─────────────────────────────
//
// A panel you keep open while you work has to be able to get out of the way, and
// re-sizing it on every open is the same annoyance as re-ticking four onions.
// Stored per browser in localStorage: a personal convenience, nothing the server
// should know or the account should carry.
//
// ⚠ Every read and write is wrapped. A private window, cleared site data or a
// browser set to block storage throws on the ACCESSOR rather than returning
// nothing, and an unguarded read there takes the whole panel down with it.
const GEO_KEY = 'wsp.geometry';

function loadGeometry() {
  try { return JSON.parse(localStorage.getItem(GEO_KEY) || 'null') || null; } catch { return null; }
}
function saveGeometry(g) {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch { /* refused — the panel still works */ }
}

function applyGeometry() {
  const box = el('workspace-box');
  const g = loadGeometry();
  if (!box || !g) return;
  // Clamped to the CURRENT viewport. A position saved on a wide monitor must not
  // put the header off the edge of a laptop screen, where there is nothing left
  // to drag it back by.
  if (g.w) {
    box.style.width = Math.min(Math.max(g.w, 420), globalThis.innerWidth) + 'px';
    box.style.maxWidth = 'none';
  }
  if (g.h && !g.compact) {
    box.style.height = Math.min(Math.max(g.h, 260), globalThis.innerHeight) + 'px';
    box.style.maxHeight = 'none';
  }
  if (g.h) box.dataset.fullHeight = Math.min(Math.max(g.h, 260), globalThis.innerHeight) + 'px';
  if (g.x != null && g.y != null) {
    box.style.transform = 'none';
    box.style.left = Math.max(0, Math.min(globalThis.innerWidth - 160, g.x)) + 'px';
    box.style.top = Math.max(0, Math.min(globalThis.innerHeight - 48, g.y)) + 'px';
  }
  if (g.compact) {
    box.classList.add('wsp-compact');
    const btn = el('workspace-compact');
    if (btn) btn.textContent = 'Expand';
  }
}

function rememberGeometry() {
  const box = el('workspace-box');
  if (!box) return;
  const r = box.getBoundingClientRect();
  const compact = box.classList.contains('wsp-compact');
  const h = compact ? parseFloat(box.dataset.fullHeight || '') || null : r.height;
  saveGeometry({ x: r.left, y: r.top, w: r.width, h, compact });
}

// COMPACT — the dials, the ribbon and the replies, and nothing else.
//
// The full panel is a working screen and it is the right thing when you are
// deciding what to cook. Once the pan is on, the only two questions left are
// where the burner is and what the game just said, and a screenful of fridge
// contents is in the way of both. Same window, same position, one class.
function toggleCompact() {
  const box = el('workspace-box');
  if (!box) return;
  const on = box.classList.toggle('wsp-compact');
  if (on) {
    box.dataset.fullHeight = box.style.height || '';
    box.style.height = '';           // fit the dials, the ribbon and the replies
  } else if (box.dataset.fullHeight) {
    box.style.height = box.dataset.fullHeight;
    box.style.maxHeight = 'none';
  }
  const btn = el('workspace-compact');
  if (btn) btn.textContent = on ? 'Expand' : 'Compact';
  rememberGeometry();
}

function wireResize() {
  const grip = el('workspace-grip');
  const box = el('workspace-box');
  if (!grip || !box) return;
  let sx = 0, sy = 0, sw = 0, sh = 0;
  grip.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
    // The box is centred by transform; resizing has to pin it first or it grows
    // from the middle in both directions and the grip runs away from the pointer.
    box.style.transform = 'none';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    // ⚠ SIZE BEFORE CAP. Lifting `max-width` on a percentage-width box resizes it
    // on the spot — pinning the current size first is what stops the panel
    // jumping out from under the grip the moment it is touched.
    box.style.width = r.width + 'px';
    if (!box.classList.contains('wsp-compact')) box.style.height = r.height + 'px';
    box.style.maxWidth = 'none';
    box.style.maxHeight = 'none';
    try { grip.setPointerCapture(e.pointerId); } catch { /* the drag still tracks over the grip */ }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    box.style.width = Math.max(420, sw + (e.clientX - sx)) + 'px';
    // Compact sizes itself to its contents; pinning a height there would put an
    // empty gap under the replies and make the button do two things at once.
    if (!box.classList.contains('wsp-compact')) box.style.height = Math.max(260, sh + (e.clientY - sy)) + 'px';
  });
  grip.addEventListener('pointerup', () => rememberGeometry());
}

// ⚠ THE BATCH IS ONE COMMAND, NOT ONE PER ROW.
//
// Firing four `stow`s from the browser looks identical and is wrong in three
// ways: they interleave at every await on the server, they spend the
// connection's whole rate-limit burst, and — the one that actually bites — a
// step that raises a SIFT disambiguation would have the REST OF THE BATCH read
// as answers to it. The server's plan runner is serial, stops on the first
// failure and stops dead at a prompt, so the batch goes through that.
//
// This file still holds no verb knowledge: `prefix` and `sep` came off the
// payload and the names came off the rows. It concatenates; it does not compose.
function sendBatch(vesselId) {
  const v = (lastData?.area || []).find(a => String(a.id) === String(vesselId));
  if (!v?.batch) return;
  // Insertion order — the order the player ticked them, which is the order they
  // go in the pan. In a kitchen where the method is half the dish, that is not
  // an arbitrary order to preserve.
  const names = [...picked].map(id => rowIndex.get(id)?.name).filter(Boolean);
  if (!names.length) return;
  sendCmd(v.batch.prefix + names.join(v.batch.sep || ', '));
  sendCmdSilent('workspace');
}

// Several id-addressed commands in a row, paced so the connection's token bucket
// never sees a burst. `pullid` cannot raise a disambiguation — that is the whole
// reason it is id-shaped — so unlike the batch above these are safe to send one
// at a time from here.
const DRIP_MS = 250;
function drip(cmds) {
  cmds.forEach((c, i) => setTimeout(() => { if (active) panelSend(c); }, i * DRIP_MS));
  setTimeout(() => { if (active) sendCmdSilent('workspace'); }, cmds.length * DRIP_MS);
}

function takePicked() {
  drip([...picked]
    .map(id => (rowIndex.get(id)?.actions || []).find(a => a.role === 'take')?.command)
    .filter(Boolean));
}

function render(data) {
  lastData = data;
  // Before anything is drawn: a row's chip strip depends on whether the panel has
  // a better way to load a pan than a chip per pan.
  hasBatch = (data?.area || []).some(v => v.batch && !v.idle);
  hasDials = !!(data?.dials || []).length;
  recomputeWanted(data);
  indexRows(data);
  scheduleTick(data);

  el('workspace-title').textContent = data.title || 'WORKSPACE';
  // A room can be two workspaces at once — a kitchen with a chem lab in the back
  // is the case this exists for. The server picks one by priority; this is how
  // you say you meant the other, and it's an ordinary `workspace <key>`.
  const others = (data.providers || []).filter(p => p.key !== data.provider);
  el('workspace-provider').innerHTML = others.length
    ? others.map(p => `<button class="wsp-act" data-cmd="workspace ${esc(p.key)}" title="workspace ${esc(p.key)}">${esc(p.key)}</button>`).join('')
    : (data.provider ? `[${esc(data.provider)}]` : '');

  // TWO COLUMNS: the working area, and what you could put into it. Everything
  // with a clock in it is on the left; everything you pick from is on the right.
  const work = [];
  work.push(section('On the surface', renderArea(data.area || []), 'nothing out — no pan, no free ring'));

  const supply = [];
  // One button for the whole highlighted shelf. It fires the same `pullid` the
  // per-row Take button does, once each — a convenience over existing verbs, not
  // a new mechanic, which is why it needs nothing on the server.
  const toPull = wantedInStorage(data);
  const pullAll = toPull.length
    ? `<div class="wsp-row wsp-pullall"><button class="wsp-act" id="wsp-take-marked">take the ${toPull.length} marked</button></div>`
    : '';
  supply.push(section('To hand',
    (data.components || []).map(c => componentLine(c)).join(''), 'nothing to hand'));
  supply.push(section('In reach', renderStorage(data.storage || []) + pullAll, 'no storage in reach'));
  if ((data.tools || []).length) {
    // Tools are the one list you never pick FROM — they are a statement about
    // what the room lets you do. One line, not a column of rows.
    supply.push(section('Tools',
      `<div class="wsp-row wsp-toolline">${data.tools.map(c => esc(c.name)).join(' · ')}</div>`, ''));
  }

  const body = [`<div class="wsp-grid"><div class="wsp-col">${work.join('')}</div>`
    + `<div class="wsp-col">${supply.join('')}</div></div>`];

  // The recipes run the full width under both columns. They are reference, not
  // the working area, and a recipe card is prose — it reads badly in a half
  // column beside a pan.
  if (data.assistant) {
    body.push(section('Recipe Assistant', renderAssistant(data.assistant), 'nothing to suggest'));
    // ...and the card for each recipe you have open, below it. Nothing is open
    // on a fresh panel, so this costs an untouched workspace no rows at all.
    const byKey = new Map(allRecipes(data).map(r => [r.key, r]));
    for (const key of ordinals.keys()) {
      const r = byKey.get(key);
      if (!r) continue;
      const ord = ordinals.size > 1 ? `${ordinals.get(key)} · ` : '';
      body.push(section(`Recipe — ${ord}${r.name}`, renderRecipeCard(r), 'nothing written down for it'));
    }
  }

  el('workspace-body').innerHTML = body.join('');
  el('workspace-status').innerHTML = renderStatus(data.status || []);
  el('workspace-stages').innerHTML = renderStages(data.stages);
  // ⚠ NOT WHILE A KNOB IS BEING TURNED. Rewriting this subtree replaces the SVG
  // the pointer is captured on. The tick is already suppressed during a drag;
  // this covers a refresh arriving from anything else at the same moment.
  if (!dialDrag) el('workspace-dials').innerHTML = renderDials(data.dials || []);
  el('workspace-tray').innerHTML = renderTray(data);
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
  panelSend(cmd);
  sendCmdSilent('workspace');
}

export function initWorkspacePanel() {
  initFeed();
  el('workspace-compact').addEventListener('click', toggleCompact);
  // The burner's own chips (off / low / mid / high) are ordinary command
  // buttons and run the way every other chip on this panel does.
  el('workspace-dials').addEventListener('click', (e) => {
    const btn = e.target.closest('.wsp-act');
    if (btn) runAction(btn.getAttribute('data-cmd'));
  });
  el('workspace-close').addEventListener('click', closeWorkspacePanel);
  el('workspace-close-btn').addEventListener('click', closeWorkspacePanel);
  el('workspace-refresh').addEventListener('click', () => sendCmdSilent('workspace'));
  el('workspace-panel').addEventListener('click', (e) => {
    if (e.target.id === 'workspace-panel') closeWorkspacePanel();
  });
  // Delegated: the body is rewritten on every refresh, so per-button listeners
  // would leak one set per build.
  // A tick is state, not a command — it changes nothing on the server, so it
  // re-renders locally and sends nothing at all. `change` rather than `click`, so
  // Space on a focused checkbox counts the same as a mouse.
  el('workspace-body').addEventListener('change', (e) => {
    const box = e.target.closest('.wsp-tick');
    if (!box) return;
    const id = box.getAttribute('data-pick');
    // The id came out of the DOM as a string and the payload's ids are numbers
    // for inventory rows — so it is matched back against the index rather than
    // trusted, or every tick would be a key nothing else in the panel knows.
    const key = [...rowIndex.keys()].find(k => String(k) === id);
    if (key === undefined) return;
    if (box.checked) picked.add(key); else picked.delete(key);
    if (lastData) render(lastData);
  });
  el('workspace-body').addEventListener('click', (e) => {
    if (e.target.id === 'wsp-take-marked') {
      drip(wantedInStorage(lastData).map(id => `pullid ${id}`));
      return;
    }
    // The "put the ticked things in this pan" button that sits on a station,
    // beside the pan it names. The tray carries the same button for the case
    // where the pans have scrolled out of sight.
    const dropBtn = e.target.closest('[data-batch]');
    if (dropBtn) { sendBatch(dropBtn.getAttribute('data-batch')); return; }
    // Opening "cook it…" is local state, not a command — it sends nothing and
    // re-renders in place, exactly like a tick. Checked BEFORE the generic chip
    // handler below, because the toggle is itself a `.wsp-act` (it has to look
    // like one) and would otherwise be dispatched as a command with no `data-cmd`.
    const mt = e.target.closest('[data-bank]');
    if (mt) {
      const key = mt.getAttribute('data-bank');
      if (banksOpen.has(key)) banksOpen.delete(key); else banksOpen.add(key);
      if (lastData) render(lastData);
      return;
    }
    // `.wsp-run` is a whole runbook step; `.wsp-act` is a chip on a row. Both
    // carry one command in `data-cmd`, and both run the same way.
    const btn = e.target.closest('.wsp-act, .wsp-run');
    if (btn) { runAction(btn.getAttribute('data-cmd')); return; }
    // A tick is a label click, and a label click is not a recipe click. Without
    // this, ticking an onion inside an open recipe's row would also close the
    // recipe underneath it.
    if (e.target.closest('.wsp-tick, label.wsp-name')) return;
    const recipe = e.target.closest('[data-recipe]');
    if (recipe) selectRecipe(recipe.getAttribute('data-recipe'));
  });
  el('workspace-tray').addEventListener('click', (e) => {
    if (e.target.id === 'wsp-tray-clear') {
      picked = new Set();
      if (lastData) render(lastData);
      return;
    }
    if (e.target.id === 'wsp-tray-take') { takePicked(); return; }
    const dropBtn = e.target.closest('[data-batch]');
    if (dropBtn) sendBatch(dropBtn.getAttribute('data-batch'));
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
