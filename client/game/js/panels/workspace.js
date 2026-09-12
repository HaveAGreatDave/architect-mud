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
  }
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
  if (cook.phase === 'window') return `<span class="wsp-window">READY — plate it</span>`;
  if (cook.phase === 'over') return `<span class="wsp-over">PAST IT</span>`;
  if (cook.phase === 'burnt') return `<span class="wsp-burnt">BURNING</span>`;
  if (!cook.stages) return '';
  const pips = Array.from({ length: cook.stages }, (_, i) => (i < cook.stage ? '●' : '○')).join('');
  return `<span class="wsp-pips${cook.phase === 'thaw' ? ' wsp-thaw' : ''}">${pips}</span>`;
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
    + actionStrip(shownActions(c)) + `</div>`;
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
  const heatBank = byRole(v.actions, 'heat');
  const waterBank = byRole(heatBank.rest, 'water');
  // The badge is the FALLBACK, not a companion to the selector. Where there is a
  // selector it already shows which ring is lit, and printing "burner mid" beside
  // a highlighted MID is the same fact twice — which reads as two settings.
  const heat = (v.heat && !heatBank.taken.length)
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
  const foot = waterBank.rest.length
    ? `<div class="wsp-row wsp-vessel-foot">${actionStrip(waterBank.rest)}</div>` : '';

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
      const head = `<div class="wsp-row wsp-recipe${open ? ' wsp-open' : ''}" data-recipe="${esc(r.key)}">`
        + `${ord}<span class="wsp-name">${esc(r.name)}</span>`
        + (r.band ? `<span class="wsp-note"> ${esc(r.band)}</span>` : '')
        + ` ${bar(r.pct)}<span class="wsp-qty"> ${r.pct}%</span>`
        + `<span class="wsp-state"> — ${need}</span>`
        + actionStrip(r.actions) + `</div>`;
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
function renderRecipeCard(r) {
  const body = [];
  for (const line of r.ingredients || []) body.push(`<div class="wsp-row wsp-step">· ${esc(line)}</div>`);
  // What it's made IN, ticked against the room — the same question the
  // ingredients above answer, asked of the cupboard instead of the fridge.
  for (const g of r.kit || []) {
    const mark = g.held ? '✓' : (g.req === 'required' ? '✗' : '·');
    body.push(`<div class="wsp-row wsp-step${g.held ? '' : ' wsp-short'}">${mark} ${esc(g.label)}</div>`);
  }
  if (body.length && (r.method || []).length) body.push(`<div class="wsp-row wsp-step"> </div>`);
  (r.method || []).forEach((line, i) => {
    // Deliberately NOT escaped: the method comes from the server's own catalog
    // and may carry a <b> around the verb it wants you to type.
    body.push(`<div class="wsp-row wsp-step">${i + 1}. ${line}</div>`);
  });
  return body.join('');
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
  cmds.forEach((c, i) => setTimeout(() => { if (active) sendCmd(c); }, i * DRIP_MS));
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
