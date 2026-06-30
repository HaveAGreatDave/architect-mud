import { state } from './state.js';
import { sendCmd } from './net.js';
import { appendHtml } from './render.js';
import { MARKUP_HELP_HTML, STATUS_TEMPLATE } from './markup.js';
import { appendToWhisperLog, sendToActiveTab } from './panels/whisper.js';
import { openMusicPlayerPanel } from './panels/musicplayer.js';

function handleClientCommand(cmd) {
  const lower = cmd.toLowerCase();
  if (lower === 'music') { openMusicPlayerPanel(); return true; }
  if (lower === '.markup') {
    // Prefer showing in the active whisper tab; fall back to game log
    const whisperShown = appendToWhisperLog(MARKUP_HELP_HTML);
    if (!whisperShown) appendHtml(MARKUP_HELP_HTML);
    return true;
  }
  if (lower === '.status') {
    sendToActiveTab(STATUS_TEMPLATE);
    return true;
  }
  return false;
}

export function initInput() {
  const input = document.getElementById('cmd-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (!cmd) return;
      state.cmdHistory.unshift(cmd);
      state.historyIdx = -1;
      input.value = '';
      if (handleClientCommand(cmd)) return;
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
