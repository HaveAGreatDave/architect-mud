function openSettingsPanel() {
  document.getElementById('settings-overlay').classList.add('active');
  applyDevSettings();
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

