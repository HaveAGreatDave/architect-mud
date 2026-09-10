// The tablet, as a document you can navigate — the third surface.
//
// There were two before this, and each is a different answer to a different
// question. `accessibility` (a11y-command.js) writes settings into the log,
// because the switch that fixes the interface must not be inside the interface.
// `tablet verbs` (plugins/tablet/text-index.js) lists what you can TYPE, because
// at the `log` rung the graphical OS is not there. Both stay exactly as they are.
//
// This is for the player who wants the tablet to still feel like a tablet: a
// thing you open, move around inside, and close — rather than a burst of text
// that scrolls away up the transcript and has to be re-summoned to be re-read.
// A screen reader's virtual cursor can walk a dialog at its own pace, backwards,
// by heading, by list, by control. It cannot do any of that with a log line that
// has already been overtaken by three combat messages.
//
// ── The four decisions ──────────────────────────────────────────────────────
//
// 1. **The panel is `#tablet-a11y-panel`, and that name is load-bearing.**
//    a11y-focus.js matches `[id$="-panel"]` and hands anything it matches
//    `role="dialog"`, `aria-modal="true"`, a Tab/Shift-Tab focus trap, Escape
//    that clicks our own close control, and focus restored to whatever was
//    focused before. NONE of that is implemented here, on purpose — a second
//    focus trap in the same client is a second thing to get wrong. Rename this
//    panel and you silently lose all six behaviours at once.
//
// 2. **Settings is real `<input type="radio">` in a real `<fieldset>`.**
//    Not buttons with aria-checked, not a listbox. Native radios give grouping,
//    arrow-key navigation, "3 of 6" position announcements and the group's name
//    re-announced on entry — all from the browser, identically in every screen
//    reader, with no keyboard code in this file. The graphical tablet's pill rows
//    are divs; that is precisely why they don't read.
//
// 3. **List rows are `<button>`.** The graphical OS renders its rows as
//    `<div data-open-item>` (tablet-os.js renderList) — the primary navigation
//    element of the whole tablet is unfocusable, which is the single biggest
//    reason it cannot be driven by keyboard. Here a row is a button, so it is
//    tabbable, Enter/Space works, and it announces as a button.
//
// 4. **A view we cannot render generically NAMES THE VERB instead.** ~25 of the
//    tablet's views are bespoke client renderers with no structured payload
//    (health, map, gear, codex, calendar…). Rendering those blind would mean
//    reimplementing them. So the fallback is not an empty dialog and not an
//    apology — it is the verb that does the same job at the prompt, which is
//    real and works today. An honest dead end that hands you the way through.
//
// The generic renderer covers `list`, `detail`, `error` and `categories`, which
// is 97 of the tablet's ~130 payload sites. See docs/systems-display-mode.md.
import {
  loadSettings, saveSettings, applySettings,
  A11Y_OPTIONS, effectiveOptionValue, tabletStyle,
} from '../../../shared/settings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The display rung last seen on a payload. Settings' own screen ships it
// (settings-app.js), and Sound Detail needs it to resolve its tri-state default —
// without it a log-rung player is told "Limited" while Full is what they have.
let _rung = null;

// The app this dialog is currently showing, so an action knows what to send back.
let _app = null;
let _params = '';

let _send = null;   // sendCmdSilent, injected at wire time

/** True when the tablet should render as a document rather than a screen.
 *  Tri-state: an explicit choice wins at any rung, and never-chosen derives from
 *  the rung — so a log-mode player gets this surface without configuring anything.
 *  `rung` is optional; the module remembers the last one it saw. */
export function isA11yTablet(settings, rung) {
  return tabletStyle(settings || loadSettings(), rung !== undefined ? rung : _rung) === 'accessible';
}

// ── The panel itself ────────────────────────────────────────────────────────

function styles() {
  if (document.getElementById('tablet-a11y-css')) return;
  const s = document.createElement('style');
  s.id = 'tablet-a11y-css';
  // Deliberately plain. This surface is read, not looked at, and every rule here
  // is either legibility or hit-area. Colours come from the theme variables so it
  // follows contrast/theme choices the player has already made.
  s.textContent = `
    #tablet-a11y-panel { position:fixed; inset:auto; top:50%; left:50%; transform:translate(-50%,-50%);
      width:min(44rem,96vw); max-height:88vh; display:none; flex-direction:column; z-index:900;
      background:var(--bg-panel,#12161c); color:var(--text,#d8dee9);
      border:2px solid var(--accent,#6aa7c4); border-radius:6px; box-shadow:0 0 0 100vmax rgba(0,0,0,.55); }
    #tablet-a11y-panel.active { display:flex; }
    #tablet-a11y-panel .ta-head { display:flex; align-items:center; gap:.75rem; padding:.75rem 1rem;
      border-bottom:1px solid var(--border,#2a3340); flex:0 0 auto; }
    #tablet-a11y-panel .ta-head h2 { margin:0; font-size:1.15rem; flex:1 1 auto; }
    #tablet-a11y-panel .ta-close { margin-left:auto; font-size:1.1rem; line-height:1; padding:.4rem .7rem;
      background:var(--bg-input,#1b222b); color:inherit; border:1px solid var(--border,#2a3340); border-radius:4px; cursor:pointer; }
    #tablet-a11y-panel .ta-body { overflow-y:auto; padding:1rem; flex:1 1 auto; }
    #tablet-a11y-panel .ta-crumb { font-size:.9em; opacity:.8; margin:0 0 .75rem; }
    #tablet-a11y-panel ul.ta-list { list-style:none; margin:0; padding:0; }
    #tablet-a11y-panel ul.ta-list ul { list-style:none; margin:0 0 0 1.25rem; padding:0; }
    #tablet-a11y-panel .ta-row { display:block; width:100%; text-align:left; padding:.6rem .7rem; margin:.15rem 0;
      background:var(--bg-input,#1b222b); color:inherit; border:1px solid var(--border,#2a3340);
      border-radius:4px; cursor:pointer; font:inherit; }
    #tablet-a11y-panel .ta-row:hover { border-color:var(--accent,#6aa7c4); }
    #tablet-a11y-panel .ta-row .ta-sub { display:block; opacity:.75; font-size:.9em; margin-top:.15rem; }
    #tablet-a11y-panel li.ta-static { padding:.6rem .7rem; margin:.15rem 0; opacity:.85; }
    #tablet-a11y-panel fieldset { border:1px solid var(--border,#2a3340); border-radius:4px; margin:0 0 1.25rem; padding:.75rem 1rem 1rem; }
    #tablet-a11y-panel legend { font-weight:bold; padding:0 .4rem; }
    #tablet-a11y-panel .ta-why { margin:.25rem 0 .75rem; opacity:.8; font-size:.92em; }
    #tablet-a11y-panel .ta-opt { display:block; padding:.3rem 0; cursor:pointer; }
    #tablet-a11y-panel .ta-opt input { margin-right:.5rem; }
    #tablet-a11y-panel .ta-actions { display:flex; flex-wrap:wrap; gap:.5rem; padding:.75rem 1rem;
      border-top:1px solid var(--border,#2a3340); flex:0 0 auto; }
    #tablet-a11y-panel .ta-actions button { padding:.5rem .9rem; font:inherit; cursor:pointer;
      background:var(--bg-input,#1b222b); color:inherit; border:1px solid var(--border,#2a3340); border-radius:4px; }
    #tablet-a11y-panel .ta-actions button[disabled] { opacity:.5; cursor:default; }
    #tablet-a11y-panel .ta-note { margin:1rem 0 0; padding:.7rem; border-left:3px solid var(--accent,#6aa7c4); opacity:.9; }
  `;
  document.head.appendChild(s);
}

function panel() {
  let el = document.getElementById('tablet-a11y-panel');
  if (el) return el;
  styles();
  el = document.createElement('div');
  el.id = 'tablet-a11y-panel';
  // No role/aria-modal here: a11y-focus.js stamps both onto whatever is topmost,
  // and two sources for the same attribute is how they drift apart.
  el.innerHTML = `
    <div class="ta-head">
      <h2 id="ta11y-title" tabindex="-1">Tablet</h2>
      <button type="button" class="ta-close" aria-label="Close tablet">Close</button>
    </div>
    <div class="ta-body" id="ta11y-body"></div>
    <div class="ta-actions" id="ta11y-actions"></div>`;
  document.body.appendChild(el);
  el.querySelector('.ta-close').addEventListener('click', close);
  wire(el);
  return el;
}

export function close() {
  const el = document.getElementById('tablet-a11y-panel');
  if (el) el.classList.remove('active');
}

// One delegated listener for the panel's whole lifetime — the body is rewritten
// on every render, so per-element listeners would leak with each navigation.
function wire(el) {
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-open-item]');
    if (row && el.contains(row)) {
      send(`tabletnav ${_app} ${row.dataset.openItem}`);
      return;
    }
    const act = e.target.closest('[data-act-id]');
    if (act && el.contains(act)) return runAction(act);
  });

  // Settings radios commit on change, which is what a keyboard user generates by
  // arrowing within the group — so there is no separate Apply button to find.
  el.addEventListener('change', (e) => {
    const r = e.target.closest('input[type="radio"][data-a11y-key]');
    if (!r) return;
    const { a11yKey } = r.dataset;
    if (a11yKey === '__rung') { send(`displaymode ${r.value}`); _rung = r.value; return; }
    const settings = loadSettings();
    settings[a11yKey] = r.value;
    saveSettings(settings);
    applySettings(settings);
    announce(`${r.dataset.a11yLabel} set to ${r.dataset.a11yText}.`);
  });
}

function send(cmd) { if (_send) _send(cmd); }

/** Wire the sender once at boot (main.js). Kept out of module scope so this file
 *  imports nothing from the socket layer and stays testable in Node. */
export function initA11yTablet(sendCmdSilent, displayRung) {
  _send = sendCmdSilent;
  // The rung the server settled on at auth. Needed BEFORE the first payload
  // arrives, because it decides which of the two tablets the very first `tablet`
  // opens — and the derived default is the whole point for a log-rung player.
  if (displayRung) _rung = displayRung;
}

// A change made with the keyboard produces no visible event a screen reader would
// otherwise report, so it is spoken through the log's existing live region rather
// than a second one of our own — one live region per document is the contract in
// docs/systems-display-mode.md.
function announce(text) {
  const out = document.getElementById('output');
  if (!out) return;
  const d = document.createElement('div');
  d.className = 'msg-system';
  d.textContent = text;
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
}

function runAction(btn) {
  const { actId, actApp, actParams, actPrompt, actConfirm } = btn.dataset;
  if (actConfirm && !window.confirm(actConfirm)) return;
  let extra = '';
  if (actPrompt) {
    const answer = window.prompt(actPrompt);
    if (answer == null) return;
    extra = ` ${answer}`;
  }
  send(`tabletaction ${actApp} ${actId} ${actParams || ''}${extra}`.trim());
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderRows(items) {
  if (!items?.length) return '<p>Nothing here.</p>';
  // The graphical list nests four levels (group / child / option / part) by CSS
  // indent alone, which conveys nothing to a screen reader. Here nesting is real
  // <ul> nesting, so "list, 3 items, level 2" comes out of the browser for free.
  // `or` is spoken rather than shown, because an option is an ALTERNATIVE to the
  // line above it and indentation cannot say that.
  const li = (it) => {
    const badge = it.badge ? ` (${esc(it.badgeLabel || it.badge)})` : '';
    const label = `${it.or ? 'or ' : ''}${esc(it.label)}${badge}`;
    const sub = it.sub ? `<span class="ta-sub">${esc(it.sub)}</span>` : '';
    // A row with no id navigates nowhere — in the graphical OS those rows were
    // still clickable and threw you back to the app root. A static row here is
    // simply not a button, which is also the honest thing to announce.
    return it.id == null || it.id === ''
      ? `<li class="ta-static">${label}${sub}</li>`
      : `<li><button type="button" class="ta-row" data-open-item="${esc(it.id)}">${label}${sub}</button></li>`;
  };
  let html = '<ul class="ta-list">';
  let openChild = false;
  for (const it of items) {
    const nested = it.child || it.option || it.part;
    if (nested && !openChild) { html += '<ul>'; openChild = true; }
    if (!nested && openChild) { html += '</ul>'; openChild = false; }
    html += li(it);
  }
  if (openChild) html += '</ul>';
  return html + '</ul>';
}

function renderDetail(d) {
  const det = d.detail || {};
  let html = '';
  if (det.name) html += `<h3>${esc(det.name)}</h3>`;
  if (det.desc) html += `<p>${esc(det.desc)}</p>`;
  if (det.body) html += `<p>${esc(det.body)}</p>`;
  // Detail rows are label/value pairs — a description list says exactly that, and
  // screen readers navigate one by term.
  if (det.rows?.length) {
    html += '<dl>' + det.rows.map(r =>
      `<dt>${esc(r.label ?? r.k ?? '')}</dt><dd>${esc(r.value ?? r.v ?? '')}</dd>`).join('') + '</dl>';
  }
  return html || '<p>Nothing to show.</p>';
}

// Every option in A11Y_OPTIONS, plus Display Mode — which is deliberately NOT in
// that table (it is server state, not a localStorage preference) but is the most
// consequential control on the screen, so it is rendered first here exactly as the
// verb prints it first.
function renderSettings() {
  const settings = loadSettings();
  const ctx = { displayRung: _rung };
  const group = (name, why, key, opts, current) => {
    const id = `ta-fs-${key}`;
    return `<fieldset>
      <legend id="${id}">${esc(name)}</legend>
      <p class="ta-why">${esc(why)}</p>
      ${opts.map((o, i) => {
        const on = String(current) === String(o.v);
        return `<label class="ta-opt">
          <input type="radio" name="${esc(key)}" value="${esc(o.v)}"${on ? ' checked' : ''}
            data-a11y-key="${esc(key)}" data-a11y-label="${esc(name)}" data-a11y-text="${esc(o.t)}">
          ${esc(o.t)}</label>`;
      }).join('')}
    </fieldset>`;
  };

  let html = '<p>Everything here applies immediately and is remembered on this device. '
    + 'Nothing is announced to anyone else, and none of it changes the game\'s difficulty. '
    + 'You can also set any of it by typing <strong>accessibility</strong> at the prompt.</p>';

  html += group('Display Mode',
    'How much of the game is drawn rather than written. Log writes everything into the game log for a screen reader. Text Games keeps the graphics but gives every minigame a written form you can play at your own pace.',
    '__rung',
    [{ v: 'visual', t: 'Visual' }, { v: 'textgames', t: 'Text Games' }, { v: 'log', t: 'Log' }],
    _rung || 'visual');

  for (const opt of A11Y_OPTIONS) {
    html += group(opt.label, opt.why, opt.key, opt.opts, effectiveOptionValue(opt, settings, ctx));
  }
  return html;
}

// The bespoke views. Each is a real screen with a bespoke client renderer and no
// structured payload to work from — so rather than render it badly, name the verb
// that does the same job. The verbs come from the appDef's own `verbs: []`, which
// the server already ships to the typed index, so this list cannot drift far; it
// is a fallback of last resort, not a routing table.
const VERB_HINT = {
  health: 'vitals, injuries or mutations', gear: 'inventory', map: 'map or gps',
  codex: 'codex', calendar: 'remind', library: 'library, books, page or contents',
  corp: 'corp', chat: 'whisper', tv: 'tv or watch', binder: 'cards',
  accolades: 'accolades', alarm: 'alarm', help: 'help', news: null, fakeplay: null,
};

export function renderA11yTablet(msg) {
  const el = panel();
  _app = msg.appId || _app;
  _params = msg.params || '';
  if (msg.displayRung) _rung = msg.displayRung;

  const title = el.querySelector('#ta11y-title');
  const body = el.querySelector('#ta11y-body');
  const actions = el.querySelector('#ta11y-actions');
  title.textContent = msg.appName || 'Tablet';

  const crumb = (msg.breadcrumb || []).filter(Boolean)
    .map(b => esc(typeof b === 'string' ? b : (b.label || ''))).filter(Boolean).join(' › ');

  let html = crumb ? `<p class="ta-crumb">${crumb}</p>` : '';
  const view = msg.view || msg.screen;

  if (msg.error) html += `<p role="alert">${esc(msg.error)}</p>`;
  else if (view === 'tablet_settings') html += renderSettings();
  else if (view === 'error') html += `<p role="alert">${esc(msg.message || 'Something went wrong.')}</p>`;
  else if (view === 'list' || view === 'categories') html += renderRows(msg.items || msg.rows);
  else if (view === 'detail') html += renderDetail(msg);
  else if (msg.items?.length) html += renderRows(msg.items);   // an unknown view that still shipped a list
  else {
    const hint = VERB_HINT[view] ?? VERB_HINT[_app];
    html += `<p class="ta-note">This screen is drawn rather than written, so there's nothing here to read. `
      + (hint
        ? `Type <strong>${esc(hint)}</strong> at the prompt for the same information in words.`
        : `It has no written form yet. Close this and carry on — nothing here is needed to play.`)
      + `</p>`;
  }

  body.innerHTML = html;
  actions.innerHTML = (msg.actions || []).map(a => a.disabled
    ? `<button type="button" disabled>${esc(a.label)}</button>`
    : `<button type="button" data-act-id="${esc(a.id)}" data-act-app="${esc(_app)}" data-act-params="${esc(_params)}"`
      + `${a.prompt ? ` data-act-prompt="${esc(a.prompt)}"` : ''}`
      + `${a.confirm ? ` data-act-confirm="${esc(a.confirm)}"` : ''}>${esc(a.label)}</button>`).join('');

  el.classList.add('active');
  // Focus the title, not the first control: a screen reader then reads the dialog's
  // name and role before its contents, which is the orientation a sighted player
  // gets from the panel simply appearing. a11y-focus.js keeps it from here.
  title.focus();
  return el;
}
