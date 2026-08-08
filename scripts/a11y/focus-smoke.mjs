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
import { isModalCandidate, topmostOf, looksLikeClose, findCloseControl } from '../../client/game/js/a11y-focus.js';

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

if (failed) {
  console.error(`\n✗ a11y:focus — ${failed} problem(s). See docs/systems-display-mode.md.`);
  process.exit(1);
}
console.log('✓ a11y:focus clean — dialogs trap, effects do not, and Escape closes without confirming.');
