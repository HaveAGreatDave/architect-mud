import { state } from './state.js';
import { sendCmd } from './net.js';
import { appendHtml } from './render.js';
import { MARKUP_HELP_HTML, STATUS_TEMPLATE } from './markup.js';
import { appendToWhisperLog, sendToActiveTab } from './panels/whisper.js';
import { openMusicPlayerPanel } from './panels/musicplayer.js';

function handleClientCommand(cmd, { saveOrigin, notify } = {}) {
  const lower = cmd.toLowerCase();
  if (lower === 'music') { openMusicPlayerPanel(); return true; }
  if (lower === '.markup') {
    const whisperShown = appendToWhisperLog(MARKUP_HELP_HTML);
    if (!whisperShown) appendHtml(MARKUP_HELP_HTML);
    return true;
  }
  if (lower === '.status') {
    sendToActiveTab(STATUS_TEMPLATE);
    return true;
  }
  if (lower.startsWith('.describe ') || lower === '.describe') {
    const text = cmd.slice(10).trim();
    if (!text) {
      if (notify) notify('Usage: .describe <your description> (max 200 chars)');
      return true;
    }
    if (text.length > 200) {
      if (notify) notify(`Description too long (${text.length}/200 chars).`);
      return true;
    }
    if (saveOrigin) {
      saveOrigin(text).then(ok => {
        if (ok && notify) notify('Description updated.');
      });
    }
    return true;
  }
  return false;
}

export function initInput({ saveOrigin, notify } = {}) {
  const input = document.getElementById('cmd-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (!cmd) return;
      state.cmdHistory.unshift(cmd);
      state.historyIdx = -1;
      input.value = '';
      if (handleClientCommand(cmd, { saveOrigin, notify })) return;
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
