// Focus management for every floating panel in the client, done once.
//
// THE PROBLEM. Open the trade window, or the ATM, or the loot panel, and press
// Tab. Focus walks straight out of the panel and into the page behind it — the
// smartbar, the sidebar, links in the room description — while the panel is still
// covering the screen. A sighted mouse user never notices. Someone navigating by
// keyboard is now operating controls they cannot see, in a game where several of
// those controls spend money or drop items. Press Escape and, in about half the
// panels, nothing happens. Close the panel and focus is wherever it fell, so the
// next thing you type goes nowhere.
//
// WHY THIS IS GLOBAL AND NOT PER-PANEL. There are ~40 panels. Some are built in
// index.html and shown by flipping `display`; 53 more are appended to the body at
// runtime. Hand-wiring a focus trap into each is forty chances to forget, and
// every panel added afterwards starts broken again. So this observes instead: it
// notices when something modal is on screen, whatever put it there, and manages
// focus for it. A panel gets this by existing.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never removes a panel from the DOM and
// never fabricates a close. On Escape it CLICKS the panel's own close control, so
// the panel runs its own teardown — timers, sockets, server notifications. Ripping
// a node out behind a panel's back would leak all of that. If no close control can
// be found, Escape does nothing, which is correct: some panels are a decision you
// have to actually make.
//
// See docs/systems-display-mode.md § Focus management.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

// The shortlist we ever consider. Bounded and meaningful — panels in this client
// are named `*-panel`, `*-overlay` or `*-modal` almost without exception, and
// anything that isn't can opt IN with data-a11y-modal.
const CANDIDATES = '[id$="-overlay"],[id$="-panel"],[id$="-modal"],[role="dialog"],[data-a11y-modal],.tos-panel';

// Surfaces that own the keyboard as a matter of gameplay. Trapping focus inside a
// cockpit would be actively harmful: the flight sim reads raw keydown for pitch,
// roll and throttle, and the piano turns the whole keyboard into an instrument
// (docs/systems-instruments.md — "your own note never waits for the server").
// Neither is a dialog you tab through, so neither is one of ours.
const NEVER_TRAP = [
  '#piano-panel', '.fsim', '#cockpit-hud', '.hangar-bay', '.helm-view',
  '[data-a11y-no-trap]',
];

// ── Pure predicates, exported so scripts/a11y/focus-smoke.mjs can drive them
// with plain objects instead of needing a real browser. ──────────────────────

// Decorative full-screen effects — the sanity wash, the lightning flash, the
// weather overlay, the blackout — are `position: fixed` and cover everything, and
// are emphatically NOT dialogs. Every one of them has no focusable content and/or
// `pointer-events: none`, so those two tests separate them for free rather than
// needing a list of names that would go stale.
export function isModalCandidate({ position, pointerEvents, display, visibility, opacity }, focusableCount) {
  if (position !== 'fixed' && position !== 'absolute') return false;
  if (pointerEvents === 'none') return false;
  if (display === 'none' || visibility === 'hidden') return false;
  if (Number(opacity) === 0) return false;
  return focusableCount > 0;
}

// Highest stacking order wins; DOM order breaks the tie, because a panel opened
// later sits on top of one opened earlier at the same z-index.
export function topmostOf(entries) {
  let best = null;
  for (const e of entries) {
    if (!best) { best = e; continue; }
    const z = Number.isFinite(e.z) ? e.z : 0;
    const bz = Number.isFinite(best.z) ? best.z : 0;
    if (z > bz || (z === bz && e.order >= best.order)) best = e;
  }
  return best;
}

// Close controls in this client are named a dozen different ways (`.mg-close`,
// `#tv-close-btn`, `[data-chat-close]`, `.confirm-cancel`, a bare `×`). Rather
// than a list that rots, match the two things they all share: a name that says
// close/cancel/dismiss, or a label that is just a close glyph.
export function looksLikeClose(el) {
  const id = (el.id || '').toLowerCase();
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  // `closed` is a STATE, not a control — `.shop-closed`, `.gate-closed`. Matching
  // it would shadow the real close button with a status label.
  const named = /\b[a-z-]*(close|cancel|dismiss)\b/.test(id + ' ' + cls) &&
    !/closed\b/.test(id + ' ' + cls);
  if (named) return true;
  for (const a of el.getAttributeNames?.() || []) {
    if (/close|dismiss/.test(a)) return true;
  }
  // Match by label only on a LEAF. A wrapper div's textContent includes every
  // descendant, so a container holding a Cancel button would match and then
  // swallow the click that should have reached the button itself.
  if (el.childElementCount > 0) return false;
  const t = (el.textContent || '').trim();
  return t === '×' || t === '✕' || t === '✖' || t === '⨯' || t === 'X' ||
    /^(close|cancel|done|back)$/i.test(t);
}

// ── Naming the glyph buttons ────────────────────────────────────────────────
//
// A close button whose only content is `✕` has an ACCESSIBLE NAME of `✕`, and a
// screen reader reads that character out: VoiceOver says "multiplication X",
// NVDA "times". Reported by a player in log mode, who could hear where the
// panels were and not what the button in the corner did.
//
// `title` does not save it. The accessible-name algorithm takes a button's own
// CONTENTS ahead of its title attribute, so the ~30 buttons in this client
// written `<button title="Close">✕</button>` are all named `✕` — the title is a
// mouse tooltip and nothing more. `aria-label` is the one that wins, because it
// outranks contents.
//
// Done here, as a sweep, for exactly the reason the focus trap is: there are
// ~30 of these across index.html and 50-odd panel modules, hand-fixing each is
// thirty chances to forget, and the next panel written starts broken again.
// Every element is visited once (marked with `data-a11y-named`), and the sweep
// rides the observer that was already coalescing to one pass per frame.
//
// THE NAME IS THE AUTHOR'S, NOT OURS, WHEREVER THERE IS ONE. A title becomes the
// label verbatim — which is what keeps "Remove panel" and "clear all waypoints"
// (both drawn as ✕, neither of them a close) honest. Only a glyph with nothing
// else to go on is called "Close", and that is the safe guess: in this client a
// bare ✕ with no title has always been a panel's own corner button.
const CLOSE_GLYPH = /^[×✕✖⨯✗✘xX]$/;
const NAMEABLE = 'button,[role="button"],a';

export function nameGlyphControls(root) {
  let nodes;
  try { nodes = (root || document).querySelectorAll(NAMEABLE); } catch { return; }
  for (const el of nodes) {
    if (el.hasAttribute('data-a11y-named')) continue;
    el.setAttribute('data-a11y-named', '1');
    // Never touch something that already says what it is.
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) continue;
    // Leaf only. A wrapper's textContent is its descendants', so a header div
    // holding a ✕ button would match and get named instead of the button.
    if (el.childElementCount > 0) continue;
    if (!CLOSE_GLYPH.test((el.textContent || '').trim())) continue;
    const title = (el.getAttribute('title') || '').trim();
    el.setAttribute('aria-label', title || 'Close');
  }
}

// Pick the control Escape should click. Order matters and is the whole safety
// argument: an explicit close beats a guess, and a guess never reaches anything
// that spends money. `nodes` is in DOM order.
export function findCloseControl(nodes) {
  const explicit = nodes.find(n => (n.getAttributeNames?.() || []).some(a => /close|dismiss/.test(a)));
  if (explicit) return explicit;
  const named = nodes.find(n => {
    const s = ((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '')).toLowerCase();
    return /\b[a-z-]*(close|cancel|dismiss)\b/.test(s) && !/closed\b/.test(s);
  });
  if (named) return named;
  return nodes.find(n => looksLikeClose(n)) || null;
}

// ── The live manager ────────────────────────────────────────────────────────

let _active = null;         // the element currently trapping
let _returnTo = null;       // where focus came from, restored on close
let _scheduled = false;

const focusablesIn = (el) => [...el.querySelectorAll(FOCUSABLE)].filter(n => {
  if (n.closest && NEVER_TRAP.some(sel => n.closest(sel))) return false;
  // offsetParent is null for display:none subtrees; fixed elements report null
  // too, hence the rect fallback.
  const r = n.getBoundingClientRect?.();
  return !!(n.offsetParent || (r && r.width > 0 && r.height > 0));
});

// The one scan. Both the focus trap and the disconnect sweep ask the same
// question — "what is modal on screen right now" — so they ask it in one place.
function modalEntries() {
  const entries = [];
  const nodes = [...document.querySelectorAll(CANDIDATES)];
  nodes.forEach((el, order) => {
    if (NEVER_TRAP.some(sel => el.matches?.(sel) || el.closest?.(sel))) return;
    const cs = getComputedStyle(el);
    const f = focusablesIn(el);
    if (!isModalCandidate(cs, f.length)) return;
    entries.push({ el, z: parseInt(cs.zIndex, 10), order, focusables: f });
  });
  return entries;
}

function evaluate() {
  _scheduled = false;
  // Every frame that changed the DOM, name whatever new glyph buttons arrived
  // with it. Deliberately document-wide rather than modal-only: the smartbar,
  // the room pane and the tablet all draw them outside any panel.
  nameGlyphControls(document);
  let entries = [];
  try {
    entries = modalEntries();
  } catch { return; }

  const top = topmostOf(entries);
  const next = top ? top.el : null;
  if (next === _active) return;

  // Closing: put focus back where the player left it. Without this the panel
  // vanishes and focus falls to <body>, so the next keystroke goes nowhere — the
  // single most common way a keyboard user gets stranded.
  if (_active && !next) {
    _active.removeAttribute?.('data-a11y-trapped');
    const back = _returnTo;
    _returnTo = null;
    _active = null;
    try {
      if (back && back.isConnected) back.focus({ preventScroll: true });
      else document.getElementById('cmd-input')?.focus({ preventScroll: true });
    } catch { /* the element went away with the panel */ }
    return;
  }

  if (next && next !== _active) {
    if (!_active) _returnTo = document.activeElement;
    _active?.removeAttribute?.('data-a11y-trapped');
    _active = next;
    _active.setAttribute?.('data-a11y-trapped', '1');
    // Announce it as a dialog, but never overwrite a panel that already said what
    // it is. aria-modal tells a screen reader the rest of the page is inert,
    // which is exactly what the trap makes true.
    if (!_active.getAttribute?.('role')) _active.setAttribute('role', 'dialog');
    if (!_active.hasAttribute?.('aria-modal')) _active.setAttribute('aria-modal', 'true');
    // Move focus in — but never steal it from something inside the panel that
    // already took it (a search box that autofocused, say).
    try {
      if (!_active.contains(document.activeElement)) {
        (top.focusables[0] || _active).focus?.({ preventScroll: true });
      }
    } catch { /* nothing focusable survived the frame */ }
  }
}

function schedule() {
  if (_scheduled) return;
  _scheduled = true;
  requestAnimationFrame(evaluate);
}

export function initA11yFocus() {
  if (typeof document === 'undefined' || document._a11yFocusReady) return;
  document._a11yFocusReady = true;

  // Panels arrive two ways — appended to the body at runtime (53 sites) or built
  // into index.html and revealed by flipping style/class. Watch for both, and
  // coalesce to one evaluation per frame so a panel that rewrites its innards
  // sixty times a second costs one scan, not sixty.
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'],
  });
  schedule();

  // ── The trap itself ───────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!_active || !_active.isConnected) return;

    if (e.key === 'Tab') {
      const f = focusablesIn(_active);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      const here = document.activeElement;
      // Wrap at the ends, and haul focus back if it has already escaped.
      if (!_active.contains(here)) { e.preventDefault(); first.focus({ preventScroll: true }); }
      else if (e.shiftKey && here === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
      return;
    }

    if (e.key === 'Escape') {
      // Twenty panels already bind Escape and know how to close themselves. Rather
      // than race their handlers — ours might run first, might run second, and
      // most of them never call preventDefault — wait a frame and act only if the
      // panel is STILL there. Whoever handled it, handled it.
      const wasActive = _active;
      requestAnimationFrame(() => {
        if (!wasActive.isConnected || wasActive !== _active) return;
        const cs = (() => { try { return getComputedStyle(wasActive); } catch { return null; } })();
        if (cs && cs.display === 'none') return;
        const btn = findCloseControl([...wasActive.querySelectorAll('button,[role="button"],a,span,div,[data-a11y-close]')]);
        // No close control is a real answer: some panels are a decision you have
        // to make. Never force it.
        try { btn?.click(); } catch { /* the panel's own handler threw; not ours to fix */ }
      });
    }
  });

  // Belt and braces for the mouse-and-keyboard mix: clicking the page behind an
  // open panel would otherwise park focus out there.
  document.addEventListener('focusin', (e) => {
    if (!_active || !_active.isConnected) return;
    if (_active.contains(e.target)) return;
    // The command input is always allowed. It is how you play the game, and a
    // player typing into it with a panel open is doing something deliberate.
    if (e.target?.id === 'cmd-input') return;
    const f = focusablesIn(_active);
    try { (f[0] || _active).focus({ preventScroll: true }); } catch { /* gone */ }
  });
}

// Exported for the smoke test, and for anything that needs to know whether a
// modal currently owns the keyboard.
export function activeModal() { return _active; }

// ── The disconnect sweep ────────────────────────────────────────────────────
// A dropped connection or a sign-out leaves every open dialog driving nothing:
// its buttons send commands down a socket that isn't there, and its contents
// (a depot's fleet, an ATM balance, a loot pile) are a snapshot of a world you
// are no longer in. A handful of panels wired their own `game-disconnect`
// listener; the other forty didn't, and each new one starts broken again — the
// same argument that made the focus trap global.
//
// It closes the way Escape does, and for the same reason: CLICK the panel's own
// close control so the panel runs its own teardown (rAF loops, audio, a server
// notification it owes). Nothing is ever ripped out of the DOM here. A panel
// with no close control is left alone — that is the existing contract, and a
// reload is coming behind an explicit sign-out anyway.
export function closeAllModals() {
  let entries;
  try { entries = modalEntries(); } catch { return; }
  // Topmost first: a dialog stacked over another is usually the child, and
  // closing the parent out from under it is how teardown gets skipped.
  entries.sort((a, b) => ((b.z || 0) - (a.z || 0)) || (b.order - a.order));
  for (const { el } of entries) {
    if (!el.isConnected) continue;
    const btn = findCloseControl([...el.querySelectorAll('button,[role="button"],a,span,div,[data-a11y-close]')]);
    try { btn?.click(); } catch { /* the panel's own handler threw; not ours to fix */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('game-disconnect', () => closeAllModals());
}
