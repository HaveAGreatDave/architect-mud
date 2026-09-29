// THE INTERFACE'S SOUND CONTRACT: every button, tab and pill in the client answers the hand.
//
// A game menu clicks when you touch it and a web page doesn't, and that one difference is most of
// why a panel reads as one or the other. So this is one delegated listener on the document, not a
// line in every panel: a panel written tomorrow clicks without knowing this file exists.
//
// Six cues, all in client/shared/sfx-catalog.js under `interface`, on the dry `ui` bus (the sfx
// slider moves it; the room reverb never reaches it):
//   hover   entering a control with a mouse. Never on keyboard focus, so it can't talk over a
//           screen reader, and never on touch, where a hover is the same tap as the click.
//   confirm a click on anything that isn't one of the two below.
//   cancel  back, close, revert, cancel.
//   tab     a tab, a segment, a pill: anything that switches rather than acts.
//   open / close  an app taking the room pane and handing it back (`pane:claimed` / `pane:released`).
//
// ⚠ A PANEL THAT ALREADY SOUNDS KEEPS ITS OWN VOICE. Dialogue, the minigames and the card packs
// answer their clicks with cues of their own. This listener runs after theirs (it is on the
// document, in the bubble phase), and when SIREN has just started a cue it stays quiet, so a
// click is never two sounds. A subtree can also opt out outright with `data-no-ui-sound`.
//
// Off with `accessibility clicks off` (Interface Sounds, in A11Y_OPTIONS).

let mode = 'on';
export function setUiSoundMode(v) { mode = v === 'off' ? 'off' : 'on'; }

const CONTROL = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="switch"], summary, .settings-opt';
const CANCEL_ACT = /^(back|close|cancel|revert|paint-revert|dismiss|exit)$/;
const CANCEL_TEXT = /^\s*(?:[‹<←✕×✖]\s*)?(back|close|cancel|revert|dismiss|done)\b|^\s*[✕×✖]\s*$/i;
const HOVER_GAP_MS = 45;
const OWN_CUE_MS = 40;

// For a control that answers something other than a click (confirm.js's hold), in the same voice
// and under the same switch.
export function playUi(id, gain = 1) { play(id, gain); }
function play(id, gain = 1) {
  if (mode === 'off') return;
  const eng = window.AudioEngine, def = window.SFXCatalog?.get(id);
  if (eng && def) eng.playSfx(def, gain);
}

function controlOf(target) {
  const el = target && target.closest ? target.closest(CONTROL) : null;
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
  if (el.closest('[data-no-ui-sound]')) return null;
  return el;
}

function cueFor(el) {
  const act = el.getAttribute('data-act') || '';
  const label = el.getAttribute('aria-label') || el.textContent || '';
  if (CANCEL_ACT.test(act) || CANCEL_TEXT.test(label.slice(0, 24)) || /(^|[-_\s])close($|[-_\s])/.test(el.className || '')) return 'ui-cancel';
  const role = el.getAttribute('role');
  if (role === 'tab' || role === 'switch' || role === 'menuitemradio' || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-selected')
      || el.classList.contains('settings-opt') || [...el.attributes].some(a => /^data-[\w-]*tab$/.test(a.name))) return 'ui-tab';
  return 'ui-confirm';
}

let hovered = null, hoverAt = 0, paneOpen = false;

export function initUiSound() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = controlOf(e.target);
    if (el === hovered) return;
    hovered = el;
    if (!el) return;
    const now = performance.now();
    if (now - hoverAt < HOVER_GAP_MS) return;
    hoverAt = now;
    play('ui-hover');
  });
  document.addEventListener('click', (e) => {
    const el = controlOf(e.target);
    if (!el) return;
    // The panel's own handler has run by now; if it started a cue, that cue is the answer.
    const own = window.AudioEngine?.lastSfxAt?.();
    if (own && performance.now() - own < OWN_CUE_MS) return;
    play(cueFor(el));
  });
  // An app mounting into the room pane says so (docs/reference/mobile-layout.md). Some say it again
  // on every refresh, so only the change from shut to open, and back, makes a sound.
  window.addEventListener('pane:claimed', () => { if (!paneOpen) { paneOpen = true; play('ui-open'); } });
  window.addEventListener('pane:released', () => { if (paneOpen) { paneOpen = false; play('ui-close'); } });
}
