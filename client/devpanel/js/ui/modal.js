function openSettingsPanel() {
  document.getElementById('settings-overlay').classList.add('active');
  applyDevSettings();
  snapshotDevSettings();
}
// Close via the X / backdrop: settings apply live, so "unsaved" means the panel
// state differs from the snapshot taken on open. Save keeps the live changes;
// Cancel Changes reverts to that snapshot. Both close the window.
async function attemptCloseSettings() {
  if (devSettingsChanged()) {
    const save = await dpConfirm('You have unsaved changes to your settings.', {
      title: 'Settings', okLabel: 'Save', cancelLabel: 'Cancel Changes',
    });
    if (!save) revertDevSettings();
  }
  closeSettingsPanel();
}
function closeSettingsPanel() {
  if (devSettings._contrastPreview != null) {
    delete devSettings._contrastPreview;
    const slider = document.getElementById('dev-opt-contrast');
    const label  = document.getElementById('dev-contrast-label');
    const saved  = devSettings.contrast || 0;
    if (slider) slider.value = saved;
    if (label) label.textContent = saved === 0 ? 'Base' : `+${saved}%`;
    saveDevSettings(devSettings);
    applyDevSettings();
  }
  document.getElementById('settings-overlay').classList.remove('active');
}

// Backdrop-safe close for overlays: only fire close() when BOTH the mousedown
// and the click land on the backdrop element itself. A click-drag that starts
// inside the dialog and releases on the backdrop would otherwise close it.
let _bdDownOnSelf = false;
function backdropDown(e, el) { _bdDownOnSelf = e.target === el; }
function backdropClose(e, el, close) {
  if (_bdDownOnSelf && e.target === el) { _bdDownOnSelf = false; close(); }
}

function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('generic-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('generic-modal').style.display = 'none';
  const saveBtn = document.getElementById('modal-save');
  if (saveBtn) { saveBtn.style.display = ''; saveBtn.textContent = 'Save'; }
  const revertBtn = document.getElementById('modal-revert');
  if (revertBtn) revertBtn.style.display = 'none';
  _editingPlayerId = null;
  _editingPlayerOriginal = null;
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `msg-toast${isError ? ' error' : ''} visible`;
  setTimeout(() => el.classList.remove('visible'), 5000);
}

// ── In-browser confirm/prompt/alert ─────────────────────────────────────────
// Promise-based, themed replacements for the native browser dialogs. Callers
// `await` them: dpConfirm → bool, dpPrompt → string|null (null on cancel),
// dpAlert → void. Only one shows at a time. Enter = OK, Escape/backdrop = cancel.
function _dpDialog({ title, message, kind, defaultValue, okLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    document.getElementById('dp-dialog')?.remove();
    const isPrompt = kind === 'prompt';
    const isAlert  = kind === 'alert';
    const overlay = document.createElement('div');
    overlay.id = 'dp-dialog';
    overlay.className = 'dp-dialog-overlay';
    overlay.innerHTML = `
      <div class="dp-dialog-card${danger ? ' danger' : ''}">
        <div class="dp-dialog-title"></div>
        <div class="dp-dialog-msg"></div>
        ${isPrompt ? '<input class="dp-dialog-input" type="text">' : ''}
        <div class="dp-dialog-actions">
          ${isAlert ? '' : '<button class="dp-dialog-cancel"></button>'}
          <button class="dp-dialog-ok${danger ? ' danger' : ''}"></button>
        </div>
      </div>`;
    overlay.querySelector('.dp-dialog-title').textContent = title;
    overlay.querySelector('.dp-dialog-msg').textContent = message || '';
    overlay.querySelector('.dp-dialog-ok').textContent = okLabel || 'OK';
    const cancelBtn = overlay.querySelector('.dp-dialog-cancel');
    if (cancelBtn) cancelBtn.textContent = cancelLabel || 'Cancel';
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.dp-dialog-input');
    if (input) { input.value = defaultValue != null ? String(defaultValue) : ''; input.focus(); input.select(); }
    else overlay.querySelector('.dp-dialog-ok').focus();

    const done = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onOk = () => done(isPrompt ? (input ? input.value : '') : true);
    const onCancel = () => done(isPrompt ? null : false);

    overlay.querySelector('.dp-dialog-ok').addEventListener('click', onOk);
    overlay.querySelector('.dp-dialog-cancel')?.addEventListener('click', onCancel);
    // Backdrop click = cancel (mousedown and click must both land on the overlay).
    let downSelf = false;
    overlay.addEventListener('mousedown', (e) => { downSelf = e.target === overlay; });
    overlay.addEventListener('click', (e) => { if (downSelf && e.target === overlay) onCancel(); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }
    document.addEventListener('keydown', onKey);
  });
}

function dpConfirm(message, opts = {}) {
  return _dpDialog({ kind: 'confirm', message, title: opts.title || 'Confirm', okLabel: opts.okLabel || 'OK', cancelLabel: opts.cancelLabel, danger: opts.danger });
}
function dpPrompt(message, defaultValue = '', opts = {}) {
  return _dpDialog({ kind: 'prompt', message, defaultValue, title: opts.title || 'Input', okLabel: opts.okLabel || 'OK' });
}
function dpAlert(message, opts = {}) {
  return _dpDialog({ kind: 'alert', message, title: opts.title || 'Notice', okLabel: opts.okLabel || 'OK' });
}

// ── Draggable dialog cards ──────────────────────────────────────────────────
// One delegated pointer handler makes EVERY `.dp-dialog-card` moveable by its
// title bar — the dpConfirm/Prompt/Alert cards and the world editor's inline
// "New District" (terrain) dialog alike, no per-dialog wiring. The card is
// flex-centered by its overlay, so we offset it with a translate transform
// accumulated across the drag; a freshly-built card (each dialog rebuilds its
// element) starts centered again. Mirrors the world-editor district-drag pattern
// (document-level move/up, no pointer capture); grabbing the title never trips
// the backdrop-close (that needs mousedown on the overlay itself).
(function enableDialogDrag() {
  if (window.__dpDialogDrag) return;      // install once
  window.__dpDialogDrag = true;
  const offsets = new WeakMap();          // card element → { x, y }
  let card = null, startX = 0, startY = 0, baseX = 0, baseY = 0;
  function onMove(e) {
    if (!card) return;
    const x = baseX + (e.clientX - startX);
    const y = baseY + (e.clientY - startY);
    offsets.set(card, { x, y });
    card.style.transform = `translate(${x}px, ${y}px)`;
  }
  function onUp() {
    card = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  document.addEventListener('pointerdown', (e) => {
    const title = e.target.closest?.('.dp-dialog-title');
    if (!title) return;
    card = title.closest('.dp-dialog-card');
    if (!card) return;
    const o = offsets.get(card) || { x: 0, y: 0 };
    baseX = o.x; baseY = o.y; startX = e.clientX; startY = e.clientY;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();                   // no text selection while dragging
  });
})();

