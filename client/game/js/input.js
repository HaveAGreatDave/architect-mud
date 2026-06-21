import { state } from './state.js';
import { sendCmd } from './net.js';

export function initInput() {
  const input = document.getElementById('cmd-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (!cmd) return;
      state.cmdHistory.unshift(cmd);
      state.historyIdx = -1;
      input.value = '';
      sendCmd(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.historyIdx < state.cmdHistory.length - 1) { state.historyIdx++; input.value = state.cmdHistory[state.historyIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.historyIdx > 0) { state.historyIdx--; input.value = state.cmdHistory[state.historyIdx]; }
      else { state.historyIdx = -1; input.value = ''; }
    }
  });

  // Auto-focus when user types anywhere outside input/textarea and auth screen is hidden
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.getElementById('auth-screen').style.display !== 'none') return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      input.focus();
    }
  });
}
