// The accessible tablet, actually rendered.
//
// This surface exists for players who cannot see it, which means nobody will
// notice by looking when it breaks. So the things that make it accessible at all
// — rows being BUTTONS, settings being real RADIOS in a fieldset, an unrenderable
// screen naming a verb instead of going blank — are asserted here rather than
// left to a human with a screen reader to discover.
//
// Run: node scripts/a11y/tablet-smoke.mjs   (also wired into pretest:regress)

let failed = 0;
const bad = (m, d) => { console.error(`  ✗ ${m}${d ? ` — ${d}` : ''}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

// ── Stub browser ────────────────────────────────────────────────────────────
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const els = new Map();
function stubEl(tag = 'div') {
  const el = {
    tagName: tag, id: '', className: '', textContent: '', innerHTML: '',
    dataset: {}, style: { setProperty() {}, removeProperty() {}, cssText: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, focus() { el._focused = true; },
    setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k] ?? null; },
    getAttributeNames: () => [],
    contains: () => true,
    closest: () => null,
    querySelectorAll: () => [],
    // Persistent per-selector children, so the module's repeated lookups of
    // #ta11y-body and #ta11y-actions return the same object each render.
    querySelector(sel) {
      if (!els.has(sel)) els.set(sel, stubEl());
      return els.get(sel);
    },
  };
  return el;
}
const head = stubEl();
globalThis.document = {
  documentElement: stubEl(), head, body: stubEl(),
  createElement: (t) => stubEl(t),
  getElementById: (id) => els.get(`#${id}`) || null,
  querySelector: () => null,
  addEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' });
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, AudioEngine: { applyVolumeSettings() {}, setMonoAudio() {} } };

const { renderA11yTablet, isA11yTablet } = await import('../../client/game/js/panels/tablet-a11y.js');
const { A11Y_OPTIONS } = await import('../../client/shared/settings.js');

const body = () => els.get('#ta11y-body').innerHTML;
const actions = () => els.get('#ta11y-actions').innerHTML;
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ── The mode switch is a real option on the shared table ────────────────────
{
  const row = A11Y_OPTIONS.find(o => o.key === 'tabletMode');
  if (row) ok('Tablet Style is a row on A11Y_OPTIONS, so the verb and the tablet page both render it');
  else bad('Tablet Style is missing from A11Y_OPTIONS — the verb cannot set it');
  if (row && !row.def && row.resolve) ok('…and is TRI-STATE, so `accessibility reset` cannot pin a screen-reader player back to the graphical tablet');
  else bad('Tablet Style has a hard default — reset will throw a log-rung player out of the readable tablet');
  if (!isA11yTablet({}, 'visual')) ok('…and the graphical tablet stays the default for everyone who has not chosen');
  else bad('the accessible tablet is defaulting ON — that changes the game for every existing player');
  if (isA11yTablet({}, 'log')) ok('…while an unconfigured LOG-rung player gets it derived, with nothing to find');
  else bad('a log-rung player still lands in the simulated tablet by default');
  if (isA11yTablet({ tabletMode: 'accessible' }, 'visual')) ok('…and an explicit choice wins at any rung');
  else bad('choosing Document does not enable the accessible tablet');
  if (!isA11yTablet({ tabletMode: 'visual' }, 'log')) ok('…in both directions, so log mode never forces it on somebody who said no');
  else bad('a log-rung player who explicitly chose Screen is overridden');
}

// ── A list renders as focusable buttons, not divs ───────────────────────────
{
  renderA11yTablet({
    view: 'list', appId: 'bank', appName: 'Bank',
    items: [
      { id: 'chk', label: 'Checking', sub: '₵1,204', badge: 'ok' },
      { label: 'Closed accounts' },                       // no id → not a control
      { id: 'sav', label: 'Savings', child: true },
    ],
    actions: [{ id: 'wire', label: 'Wire' }, { id: 'x', label: 'Nope', disabled: true }],
  });
  const h = body();
  const buttons = (h.match(/<button/g) || []).length;
  if (buttons === 2) ok('a list row with an id renders as a <button> — the graphical OS renders these as unfocusable divs');
  else bad(`expected 2 row buttons, got ${buttons}`, text(h).slice(0, 90));
  if (/<li class="ta-static">/.test(h)) ok('…and an id-less row is NOT a button, because it navigates nowhere');
  else bad('an id-less row was made a control — clicking it throws the player back to the app root');
  if (/<ul>/.test(h.replace('<ul class="ta-list">', ''))) ok('…and a child row nests in a real <ul>, so its level is announced');
  else bad('nesting is visual only — a screen reader cannot tell a child row from a sibling');
  if (/Checking.*₵1,204/s.test(text(h))) ok('…and the sub-label rides inside the button, so it is part of the name');
  else bad('the sub-label is outside the control', text(h).slice(0, 90));
  if (/disabled/.test(actions()) && /data-act-id="wire"/.test(actions())) ok('actions are real buttons and honour disabled');
  else bad('action buttons are wrong', text(actions()).slice(0, 90));
}

// ── Settings is native radios in a fieldset ─────────────────────────────────
{
  renderA11yTablet({ view: 'tablet_settings', appId: 'settings', appName: 'Settings', displayRung: 'log' });
  const h = body();
  const missing = A11Y_OPTIONS.filter(o => !h.includes(`>${o.label}</legend>`)).map(o => o.label);
  if (!missing.length) ok(`every one of the ${A11Y_OPTIONS.length} options renders as its own fieldset`);
  else bad(`options missing from the dialog: ${missing.join(', ')}`);
  if (/<legend id="ta-fs-__rung">Display Mode<\/legend>/.test(h)) ok('…and Display Mode is rendered first, though it is server state and not on the table');
  else bad('Display Mode is absent — the most consequential control is unreachable here');
  if (!/<input type="radio"[^>]*>(?![\s\S]*<div class="ta-pill")/.test(h) === false) { /* shape check below */ }
  const radios = (h.match(/<input type="radio"/g) || []).length;
  const expected = A11Y_OPTIONS.reduce((n, o) => n + o.opts.length, 0) + 3;   // +3 display rungs
  if (radios === expected) ok(`…as ${radios} native radio inputs, so grouping and arrow-key navigation come from the browser`);
  else bad(`expected ${expected} radios, got ${radios}`);
  // The bug this file's sibling suite already caught once, in the other surface:
  // Sound Detail is tri-state and derives to `full` at the log rung. If the dialog
  // reads the raw key instead of resolving it, nothing is checked and the player
  // is shown a group with no answer at all.
  // Slice to the END of that one fieldset — the `why` text on this option is long
  // enough that a fixed character window falls short of its inputs entirely.
  const sfxStart = h.indexOf('>Sound Detail</legend>');
  const sfx = h.slice(sfxStart, h.indexOf('</fieldset>', sfxStart));
  if (/value="full"[^>]*checked/.test(sfx)) ok('…and Sound Detail resolves its derived default, so the log rung shows Full checked');
  else bad('Sound Detail shows nothing checked at the log rung — the tri-state was read raw', text(sfx).slice(0, 120));
}

// ── A screen we cannot render names the verb instead ────────────────────────
{
  renderA11yTablet({ view: 'health', appId: 'health', appName: 'Vitals' });
  const h = text(body());
  if (/vitals, injuries or mutations/.test(h)) ok('a bespoke screen names the verb that does the same job, rather than rendering blank');
  else bad('an unrenderable screen is a dead end', h.slice(0, 120));

  renderA11yTablet({ view: 'somethingbrandnew', appId: 'nope', appName: 'Whatever' });
  const h2 = text(body());
  if (h2.length > 20 && /nothing here to read|no written form/.test(h2)) ok('…and an UNKNOWN view still says something honest instead of an empty dialog');
  else bad('an unknown view renders nothing at all', h2.slice(0, 120));

  // An unknown view that happens to ship items should still render them.
  renderA11yTablet({ view: 'mystery', appId: 'q', appName: 'Q', items: [{ id: 'a', label: 'Thing' }] });
  if (/<button/.test(body())) ok('…and an unknown view that DOES carry a list renders it rather than giving up');
  else bad('a renderable list was discarded because its view name was unfamiliar');
}

// ── Escaping ────────────────────────────────────────────────────────────────
{
  renderA11yTablet({ view: 'list', appId: 'x', appName: 'X', items: [{ id: '1', label: '<img src=x onerror=alert(1)>' }] });
  if (!/<img/.test(body())) ok('item labels are escaped');
  else bad('an item label was injected as HTML');
}

// ── The panel name is what a11y-focus.js keys on ────────────────────────────
{
  // Renaming the panel silently loses role=dialog, aria-modal, the focus trap,
  // Escape-to-close and focus restoration all at once, with nothing failing.
  const src = await (await import('node:fs/promises')).readFile('client/game/js/panels/tablet-a11y.js', 'utf8');
  if (/id\s*=\s*'tablet-a11y-panel'/.test(src)) ok('the panel id still ends in -panel, so a11y-focus.js keeps trapping and naming it');
  else bad('the panel id no longer matches a11y-focus.js CANDIDATES — the focus trap is gone');
  // Comments stripped first — this file DISCUSSES role="dialog" at length, and the
  // prose explaining why it doesn't set the attribute must not read as setting it.
  // (role="alert" on an error paragraph is a different attribute and stays.)
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  if (!/role\s*=\s*["']?dialog|aria-modal/.test(code)) ok('…and it does not stamp role/aria-modal itself, which a11y-focus.js owns');
  else bad('the panel sets role/aria-modal itself — two sources for one attribute');
}

if (failed) { console.error(`\n✗ a11y:tablet — ${failed} failure(s).`); process.exit(1); }
console.log('\n✓ a11y:tablet clean — the accessible tablet renders controls, settings and honest dead ends.');
console.log('  (Static only — what a screen reader actually SAYS still needs a human with NVDA.)');
