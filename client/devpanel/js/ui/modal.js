function openSettingsPanel() {
  document.getElementById('settings-overlay').classList.add('active');
  applyDevSettings();
}
function closeSettingsPanel() {
  document.getElementById('settings-overlay').classList.remove('active');
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
  setTimeout(() => el.classList.remove('visible'), 2500);
}

