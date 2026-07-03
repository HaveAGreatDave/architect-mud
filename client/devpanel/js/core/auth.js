async function devLogin() {
  const username = document.getElementById('dev-username').value;
  const password = document.getElementById('dev-password').value;
  const data = await API('/auth/login', 'POST', { username, password });
  if (data.error) { document.getElementById('dev-err').textContent = data.error; return; }
  if (!['admin','dev','builder','designer'].includes(data.role)) {
    document.getElementById('dev-err').textContent = 'Insufficient permissions.'; return;
  }
  token = data.token;
  devRole = data.role;
  devHandle = data.handle;
  devPlayerId = data.playerId;
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('auth-badge').textContent = `${data.handle} [${data.role}]`;
  document.getElementById('auth-badge').className = 'auth-status ok';
  if (['admin','dev'].includes(data.role)) document.getElementById('ghost-btn').style.display = '';
  loadPanel('dashboard');
  startWorldStatePolling();
  updateStagingBadge();
  showPlayButton();
  initWhisperPanel();
}

async function devpanelLogout() {
  if (!(await dpConfirm('Log out of the dev panel?'))) return;
  token = null;
  sessionStorage.removeItem('devpanel-token');
  location.reload();
}
