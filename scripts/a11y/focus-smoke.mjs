// The focus manager's decisions, exercised.
//
// The manager itself needs a real browser — MutationObserver, getComputedStyle,
// live focus. What it does NOT need a browser for is the three judgements it makes,
// and those are where it would go wrong in ways nobody notices:
//
//   • trapping a DECORATIVE overlay. The sanity wash, the lightning flash, the
//     blackout and the weather layer are all `position: fixed` covering the whole
//     screen. Trap one of those and the player is locked out of their own game by
//     a visual effect, with no dialog on screen to explain why.
//   • picking the WRONG panel when two are open. Focus goes into the one
//     underneath, which is invisible.
//   • failing to recognise a close control, so Escape silently does nothing.
//
// Run: node scripts/a11y/focus-smoke.mjs   (also wired into pretest:regress)
import { readFileSync } from 'node:fs';
import { isModalCandidate, topmostOf, looksLikeClose, findCloseControl, nameGlyphControls, nameDialog, nameField } from '../../client/game/js/a11y-focus.js';

let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (got, want, m) => (got === want ? ok(m) : bad(`${m} — got ${got}, expected ${want}`));

const style = (o = {}) => ({ position: 'fixed', pointerEvents: 'auto', display: 'block', visibility: 'visible', opacity: '1', ...o });

// ── Real dialogs are trapped ────────────────────────────────────────────────
is(isModalCandidate(style(), 3), true, 'a fixed panel with controls is treated as a dialog');
is(isModalCandidate(style({ position: 'absolute' }), 2), true, 'an absolutely-positioned panel counts too');

// ── Decorative overlays are NOT ─────────────────────────────────────────────
// Each of these is a real thing in this client. Getting any of them wrong locks
// the player out of the game behind a visual effect.
is(isModalCandidate(style({ pointerEvents: 'none' }), 0), false, 'the weather overlay (pointer-events:none) is not trapped');
is(isModalCandidate(style(), 0), false, 'the sanity wash (nothing focusable) is not trapped');
is(isModalCandidate(style({ opacity: '0' }), 4), false, 'a faded-out panel is not trapped');
is(isModalCandidate(style({ display: 'none' }), 4), false, 'a hidden panel is not trapped');
is(isModalCandidate(style({ visibility: 'hidden' }), 4), false, 'an invisible panel is not trapped');
is(isModalCandidate(style({ position: 'static' }), 4), false, 'the sidebar (in flow) is not trapped');

// ── Two panels open: the top one wins ───────────────────────────────────────
{
  const under = { el: 'loot', z: 100, order: 0 };
  const over = { el: 'confirm', z: 9000, order: 1 };
  is(topmostOf([under, over]).el, 'confirm', 'the higher z-index panel takes focus');
  is(topmostOf([over, under]).el, 'confirm', '…regardless of scan order');
  // Equal z-index: whatever opened later is drawn on top, so it must win.
  is(topmostOf([{ el: 'a', z: 50, order: 0 }, { el: 'b', z: 50, order: 1 }]).el, 'b',
    'at equal z-index the later panel wins, matching what is drawn on top');
  // A panel with `z-index: auto` must not beat a real one.
  is(topmostOf([{ el: 'auto', z: NaN, order: 5 }, { el: 'real', z: 10, order: 0 }]).el, 'real',
    'z-index:auto is treated as 0, not as infinity');
  is(topmostOf([]), null, 'no panels means nothing is trapped');
}

// ── Escape finds the close control ──────────────────────────────────────────
// The real selectors from the client, which are named a dozen different ways.
const el = (o) => ({
  id: '', className: '', textContent: '',
  getAttribute: () => null, getAttributeNames: () => Object.keys(o.attrs || {}), ...o,
});
const CLOSERS = [
  ['.mg-close', el({ className: 'mg-close' })],
  ['#tv-close-btn', el({ id: 'tv-close-btn' })],
  ['.confirm-cancel', el({ className: 'confirm-cancel' })],
  ['[data-chat-close]', el({ attrs: { 'data-chat-close': '' } })],
  ['a bare × glyph', el({ textContent: '×' })],
  ['a ✕ glyph', el({ textContent: '✕' })],
  ['a "Cancel" button', el({ textContent: 'Cancel' })],
  ['.accolade-dismiss', el({ className: 'accolade-dismiss' })],
];
for (const [name, node] of CLOSERS) {
  if (looksLikeClose(node)) ok(`Escape recognises ${name}`);
  else bad(`Escape does not recognise ${name} — that panel cannot be dismissed by keyboard`);
}

// …and does NOT fire something destructive it merely half-recognises.
const NOT_CLOSERS = [
  ['the Confirm button', el({ className: 'confirm-yes', textContent: 'Confirm' })],
  ['a Buy button', el({ className: 'shop-buy', textContent: 'Buy' })],
  ['a Sell button', el({ className: 'shop-sell', textContent: 'Sell' })],
  ['a Delete button', el({ className: 'te-delete-btn', textContent: 'Delete' })],
  ['a bare label', el({ className: 'tos-set-label', textContent: 'Font Size' })],
];
for (const [name, node] of NOT_CLOSERS) {
  if (!looksLikeClose(node)) ok(`Escape leaves ${name} alone`);
  else bad(`Escape would click ${name} — pressing Escape must never confirm, buy, sell or delete anything`);
}

// ── Picking BETWEEN candidates, in DOM order ────────────────────────────────
// The ordering rules are the safety argument, so they get tested as such.
{
  const wrapper = el({ className: 'confirm-actions', childElementCount: 2, textContent: 'Cancel Confirm' });
  const cancel = el({ className: 'confirm-cancel', textContent: 'Cancel' });
  const confirm = el({ className: 'confirm-yes', textContent: 'Confirm' });
  is(findCloseControl([wrapper, cancel, confirm]), cancel,
    'a wrapper whose text merely CONTAINS "Cancel" never shadows the real cancel button');

  // `.shop-closed` is a status label. Clicking it does nothing, but if it were
  // picked the real close button would never be reached and Escape would look broken.
  const statusLabel = el({ className: 'shop-closed', textContent: 'CLOSED' });
  const realClose = el({ className: 'mg-close', textContent: '×' });
  is(findCloseControl([statusLabel, realClose]), realClose,
    'a "closed" STATUS label is not mistaken for a close CONTROL');

  // An explicit marker beats a lucky text match further up the panel.
  const strayX = el({ textContent: '×' });
  const marked = el({ attrs: { 'data-chat-close': '' } });
  is(findCloseControl([strayX, marked]), marked, 'an explicit close attribute outranks a stray × glyph');

  // Nothing to click is a legitimate outcome, not a failure to try harder.
  is(findCloseControl([el({ textContent: 'Buy' }), el({ textContent: 'Sell' })]), null,
    'a panel with no close control is left open rather than half-actioned');
}

// ── The glyph buttons are NAMED ─────────────────────────────────────────────
// Reported by a player on the log rung: the close buttons were announced as
// "multiplication X", because a button's contents outrank its title in the
// accessible-name algorithm and `<button title="Close">✕</button>` is therefore
// named `✕`. The sweep in nameGlyphControls fixes it; these are the four
// judgements it makes, and the third is the one that would do harm if wrong.
{
  const btn = (o = {}) => {
    const attrs = { ...(o.attrs || {}) };
    return {
      childElementCount: 0, textContent: '', ...o,
      hasAttribute: (a) => a in attrs,
      getAttribute: (a) => (a in attrs ? attrs[a] : null),
      setAttribute: (a, v) => { attrs[a] = v; },
      _attrs: attrs,
    };
  };
  const sweep = (nodes) => { nameGlyphControls({ querySelectorAll: () => nodes }); return nodes; };

  const bare = btn({ textContent: '✕' });
  const titled = btn({ textContent: '✕', attrs: { title: 'Close' } });
  const remove = btn({ textContent: '✕', attrs: { title: 'Remove panel' } });
  const labelled = btn({ textContent: '✕', attrs: { 'aria-label': 'Close map' } });
  const wrapper = btn({ textContent: '✕', childElementCount: 1 });
  const word = btn({ textContent: 'Buy' });
  sweep([bare, titled, remove, labelled, wrapper, word]);

  is(bare._attrs['aria-label'], 'Close', 'a bare ✕ is named Close instead of being read as multiplication X');
  is(titled._attrs['aria-label'], 'Close', '…and so is the far more common title="Close" version');
  // The one that matters: several ✕ buttons in this client are not closes at all.
  is(remove._attrs['aria-label'], 'Remove panel', 'a ✕ that REMOVES something keeps the author\'s own word for it');
  is(labelled._attrs['aria-label'], 'Close map', 'a button that already says what it is is never rewritten');
  is(wrapper._attrs['aria-label'], undefined, 'a wrapper holding the glyph is not named in the button\'s place');
  is(word._attrs['aria-label'], undefined, 'a button with real words is left alone');
  is(bare._attrs['data-a11y-named'], '1', 'each element is marked, so the per-frame sweep visits it once');

  // A second pass must be a no-op, not a re-label — panels re-render constantly.
  bare._attrs['aria-label'] = 'Close inventory';
  sweep([bare]);
  is(bare._attrs['aria-label'], 'Close inventory', 'a later hand-written label survives the next sweep');
}

// ── The dialog itself is NAMED ──────────────────────────────────────────────
// The trap stamps role="dialog" on whatever it promotes, and an unnamed dialog
// is announced as the bare word "dialog". The tablet was one — forty screens
// behind a nameplate that nothing pointed at. These are the judgements the
// derivation makes; the last two are the ones that would do harm if wrong.
{
  const node = (o = {}) => ({ id: '', childElementCount: 0, textContent: '', ...o });
  // A panel is stubbed as its selector→node map, matching querySelector's
  // "first match in document order" for the one selector we ask about.
  const panel = (map, attrs = {}) => ({
    _attrs: attrs,
    getAttribute: (a) => (a in attrs ? attrs[a] : null),
    setAttribute: (a, v) => { attrs[a] = v; },
    querySelector: (sel) => map[sel] || null,
  });

  const nameplate = node({ textContent: 'ARCHITECT OS' });
  const tablet = panel({ '.mg-brand-name': nameplate });
  nameDialog(tablet);
  is(tablet._attrs['aria-labelledby'], nameplate.id, 'the tablet is named from its chassis nameplate, not announced as "dialog"');
  is(nameplate.id.startsWith('a11y-dlg-title-'), true, '…via a generated id, so an unnumbered heading can still be pointed at');

  // aria-labelledby rather than a copied string, so a nameplate that CHANGES
  // (the corp console shows the corp's own name) does not go stale.
  nameplate.textContent = 'ARCHITECT OS — VOID';
  is(tablet._attrs['aria-label'], undefined, 'the name is a reference to the heading, never a copy of its text');

  const heading = node({ textContent: 'Evidence Locker' });
  const plain = panel({ h2: heading });
  nameDialog(plain);
  is(plain._attrs['aria-labelledby'], heading.id, 'a panel with no chassis is named from its heading');

  // The author's own name always wins — same rule as the glyph sweep.
  const labelled = panel({ '.mg-brand-name': node({ textContent: 'ATM' }) }, { 'aria-label': 'Cash machine' });
  nameDialog(labelled);
  is(labelled._attrs['aria-labelledby'], undefined, 'a panel that already says what it is is never renamed');

  // A wrapper's textContent is its descendants' — naming from it would announce
  // the tablet as "ARCHITECT OS Tablet Interface ✕".
  const wrapper = panel({ '.mg-brand-name': node({ textContent: 'ARCHITECT OS Tablet Interface ✕', childElementCount: 3 }) });
  nameDialog(wrapper);
  is(wrapper._attrs['aria-labelledby'], undefined, 'a wrapper is not read out as the dialog\'s name');

  // The two that must stay UNNAMED rather than guess. A dialog announced with a
  // paragraph of body text, or with the close button, is worse than the gap.
  const prose = panel({ '[class*="-title"]': node({ textContent: 'x'.repeat(200) }) });
  nameDialog(prose);
  is(prose._attrs['aria-labelledby'], undefined, 'a paragraph is not mistaken for a title');

  const glyphOnly = panel({ h1: node({ textContent: '✕' }) });
  nameDialog(glyphOnly);
  is(glyphOnly._attrs['aria-labelledby'], undefined, 'a close glyph in the header is not read out as the dialog\'s name');

  const untitled = panel({});
  nameDialog(untitled);
  is(untitled._attrs['aria-labelledby'], undefined, 'a panel with no title node is left unnamed rather than named from its contents');
}

// ── The FIELDS are named ────────────────────────────────────────────────────
// 58 inputs, one aria-label. An unnamed field is announced as "edit text" and
// nothing else — and in this client that set includes the bank amount, the trade
// quantity and the ATM withdrawal. Every row below is a real markup shape from
// the panels, and the last three are the ones that would name a field WRONGLY,
// which is worse than leaving it bare.
{
  const mk = (o = {}) => {
    const attrs = { ...(o.attrs || {}) };
    const self = {
      id: '', childElementCount: 0, textContent: '', children: [], parentElement: null, _order: 0,
      ...o,
      getAttribute: (a) => (a in attrs ? attrs[a] : null),
      setAttribute: (a, v) => { attrs[a] = v; },
      contains: (n) => n === self,
      // Document order is the creation order in these fixtures.
      compareDocumentPosition: (n) => (n._order > self._order ? 4 : 2),
      _attrs: attrs,
    };
    return self;
  };
  // A row that hands back its descendants to querySelectorAll, like the real
  // thing. Document order is the order the children are listed in — NOT the order
  // the fixtures happen to be constructed in, which is what a first draft of this
  // test used, and which quietly made the readout-after-the-slider case pass for
  // the wrong reason.
  const row = (kids) => {
    const r = mk({ querySelectorAll: () => kids });
    kids.forEach((k, i) => { k.parentElement = r; k._order = i + 1; });
    return r;
  };

  // `<div class="trow"><label>Handle</label><input></div>` — the dominant idiom.
  const lbl = mk({ textContent: 'Handle' });
  const field = mk({});
  row([lbl, field]);
  nameField(field);
  is(field._attrs['aria-labelledby'], lbl.id, 'a bare <label> sitting next to its input finally names it');
  is(lbl.id.startsWith('a11y-fld-label-'), true, '…via a generated id, since only 14 of 38 labels carry a for=');

  // The settings sliders: label, then the input one <span> deeper.
  const volLbl = mk({ textContent: 'Master volume', attrs: { class: 'tos-set-label' } });
  const slider = mk({});
  const inner = mk({ querySelectorAll: () => [] });
  const outer = row([volLbl, inner]);
  slider.parentElement = inner; inner.parentElement = outer;
  slider._order = 3; // nested inside `inner`, so it follows the label in document order
  outer.querySelectorAll = () => [volLbl];
  nameField(slider);
  is(slider._attrs['aria-labelledby'], volLbl.id, 'a slider one level deeper than its label is still reached');

  // THE ONE THAT MATTERS. Every volume row ends in a percentage readout. Named
  // from that, the slider is announced as "34%" — which sounds like it worked.
  const after = mk({ textContent: '34%', attrs: { class: 'tos-set-label' } });
  const slider2 = mk({});
  row([slider2, after]);
  nameField(slider2);
  is(slider2._attrs['aria-labelledby'], undefined, 'a value readout AFTER the field is never mistaken for its label');

  // A real association is never second-guessed.
  const native = mk({ labels: [{ textContent: 'Amount' }] });
  row([mk({ textContent: 'Something else' }), native]);
  nameField(native);
  is(native._attrs['aria-labelledby'], undefined, 'a field with a real <label for> or a wrapping label is left alone');

  const already = mk({ attrs: { 'aria-label': 'Bet in credits' } });
  row([mk({ textContent: 'Stake' }), already]);
  nameField(already);
  is(already._attrs['aria-labelledby'], undefined, 'a field the author already named is never renamed');

  // title is the last resort — the colour pickers have nothing else.
  const swatch = mk({ attrs: { title: 'Pick a custom felt colour' } });
  row([swatch]);
  nameField(swatch);
  is(swatch._attrs['aria-label'], 'Pick a custom felt colour', 'a field with only a title falls back to it');

  // placeholder is deliberately NOT copied: the accessible-name algorithm already
  // falls back to it, and several panels rewrite theirs as state changes.
  const ph = mk({ attrs: { placeholder: 'Message Vale…' } });
  row([ph]);
  nameField(ph);
  is(ph._attrs['aria-label'], undefined, 'a placeholder is left to the browser rather than frozen into a label');

  // A paragraph of help text is not a label.
  const prose = mk({ textContent: 'x'.repeat(200), attrs: { class: 'tos-set-label' } });
  const field2 = mk({});
  row([prose, field2]);
  nameField(field2);
  is(field2._attrs['aria-labelledby'], undefined, 'a paragraph of help text is not read out as a field name');
}

// ── Every window is DISCOVERABLE as a dialog ────────────────────────────────
//
// The manager finds modals by a shortlist of names: `*-panel`, `*-overlay`,
// `*-modal`, `[role="dialog"]`, `[data-a11y-modal]`. A window whose class matches
// none of those gets no trap and no Escape however correct the rest of it is, and
// nothing on screen shows the difference — the only symptom is Tab walking out of
// a dialog that is still covering the page.
//
// `.confirm-window` was exactly that for the four windows in confirm.js, one of
// which takes poker bets and one of which gates sign-out. These two checks are
// here so a fifth window added to that file cannot ship the same way.
{
  const src = readFileSync(new URL('../../client/game/js/panels/confirm.js', import.meta.url), 'utf8');
  const windows = (src.match(/className = 'confirm-window/g) || []).length;
  const optIns = (src.match(/^  asDialog\(/gm) || []).length;
  is(optIns, windows, `every .confirm-window opts in as a dialog (${windows} window(s))`);

  const sift = readFileSync(new URL('../../client/game/js/panels/sift-select.js', import.meta.url), 'utf8');
  is(/setAttribute\('role', 'dialog'\)/.test(sift), true, 'the SIFT picker declares itself a dialog');
}

if (failed) {
  console.error(`\n✗ a11y:focus — ${failed} problem(s). See docs/systems-display-mode.md.`);
  process.exit(1);
}
console.log('✓ a11y:focus clean — dialogs trap, effects do not, and Escape closes without confirming.');
