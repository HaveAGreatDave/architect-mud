import { updatePanel } from '../store.js';

// Freeform scratchpad. Build the textarea once — later re-renders (triggered by
// unrelated data ticks) must not wipe what the player is typing.
export function renderNotes(bodyEl, ctx) {
  if (bodyEl.querySelector('textarea')) return;
  bodyEl.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'cpanel-notes';
  ta.placeholder = 'Notes…';
  ta.value = ctx.config.text || '';
  ta.addEventListener('input', () => {
    ctx.config.text = ta.value;
    updatePanel(ctx.instanceId, { config: ctx.config });
  });
  bodyEl.appendChild(ta);
}
