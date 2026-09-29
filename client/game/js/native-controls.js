// THE OS COLOUR DIALOG NEVER OPENS. Every <input type=color> in the client hands itself to the
// game's own picker (panels/color-picker.js) instead: one capture-phase listener, so a panel
// written tomorrow gets it without knowing this file exists.
//
// The native dialog is the worst web tell in the client: a window from the operating system, in
// its theme, that swallows drag gestures and closes on the first click (the reason the hangar
// wrote the picker in the first place). The input itself stays, so a form still reads its value
// and a screen reader still finds a labelled colour well.
//
// The picker writes back through the input's own events, which is what every caller already
// listens for: `input` on every drag frame (the truck depot's wells, the flight tune sheet) and
// `change` once, when the picker is put away (the tablet's felt and corp colours).
//
// A control that wants the OS dialog after all opts out with `data-native-color`.
import { openColorPicker } from './panels/color-picker.js';

function openFor(input) {
  openColorPicker({
    key: input, anchor: input, value: input.value,
    title: input.getAttribute('aria-label') || input.title || 'colour',
    // Custom properties inherit, so the input's own computed style carries its panel's theme.
    themeFrom: input,
    onChange: (hex) => { input.value = hex; input.dispatchEvent(new Event('input', { bubbles: true })); },
    onClose: () => input.dispatchEvent(new Event('change', { bubbles: true })),
  });
}

const pick = (t) => {
  const el = t && t.closest ? t.closest('input[type="color"]') : null;
  return el && !el.disabled && !el.closest('[data-native-color]') ? el : null;
};

export function initNativeControls() {
  document.addEventListener('click', (e) => {
    const el = pick(e.target);
    if (!el) return;
    e.preventDefault();   // cancels the input's own activation, which is the OS dialog
    openFor(el);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = pick(e.target);
    if (!el) return;
    e.preventDefault();
    openFor(el);
  }, true);
}
