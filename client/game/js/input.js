import { state } from './state.js';
import { sendCmd } from './net.js';
import { appendHtml, appendMsg } from './render.js';
import { MARKUP_HELP_HTML, STATUS_TEMPLATE } from './markup.js';
import { appendToWhisperLog, sendToActiveTab } from './panels/whisper.js';
import { openMusicPlayerPanel } from './panels/musicplayer.js';
import { isFlightSimActive, isCockpitHudActive } from './panels/cockpit.js';
import { isHangarBayWalkActive } from './panels/hangar-bay.js';
import { isTruckDepotWalkActive } from './panels/truck-depot.js';
import { isPianoKeysLive } from './panels/piano.js';
import { toggleAutoWalk, startAutoWalk, cancelAutoWalk, isAutoWalkPromptPending, answerAutoWalkPrompt } from './panels/minimap.js';
import { runMacroByName, abortMacros } from './panels/smartbar-macros.js';
import { runAccessibilityCommand } from './a11y-command.js';
import { shush } from './logreader.js';

export function handleClientCommand(cmd, { saveOrigin, notify } = {}) {
  const lower = cmd.toLowerCase();
  // A pending "auto-walk there now? (y/n)" from a manual `gps` plot. y/yes sets
  // off immediately; a plain n/no is consumed silently; anything else lets the
  // prompt lapse and runs as a normal command.
  if (isAutoWalkPromptPending()) {
    if (lower === 'y' || lower === 'yes') { answerAutoWalkPrompt(true); return true; }
    if (lower === 'n' || lower === 'no') { answerAutoWalkPrompt(false); return true; }
    answerAutoWalkPrompt(false);
  }
  if (lower === 'music') { openMusicPlayerPanel(); return true; }
  // `accessibility` / `access` / `a11y` — the settings that make the game usable,
  // reachable without the graphical surface you would otherwise need to reach
  // them through. Same reasoning as `displaymode` having no tablet gate: putting
  // the light switch inside the dark room is the oldest mistake in this field.
  // Client-side, because these are localStorage preferences and never touch the
  // server; it prints into #output, so it works at the log rung like anything else.
  if (lower === 'accessibility' || lower.startsWith('accessibility ') ||
      lower === 'access' || lower.startsWith('access ') ||
      lower === 'a11y' || lower.startsWith('a11y ')) {
    // The rung rides along because Sound Detail's default is DERIVED from it
    // rather than stored (see sfxDetail in client/shared/settings.js). Without
    // it the listing would report Limited to a log-rung player who is actually
    // hearing Full.
    appendHtml(runAccessibilityCommand(cmd.replace(/^\S+\s*/, '').trim(),
      { displayRung: state.player?.displayRung }));
    return true;
  }
  // `echo <text>` prints a local line — never sent to the server. Handy on its
  // own and the same verb macros use to surface information.
  if (lower === 'echo' || lower.startsWith('echo ')) { appendMsg(cmd.slice(4).trim(), 'system'); return true; }
  // `macro <name>` runs a saved smartbar macro by its label (client-side).
  if (lower === 'macro' || lower.startsWith('macro ')) {
    const name = cmd.slice(5).trim();
    if (!name) { if (notify) notify('Usage: macro <name>'); return true; }
    runMacroByName(name);
    return true;
  }
  // `auto` toggles GPS route auto-walk (a client-side stepper, not a server verb).
  // `auto on` / `auto off` are the explicit engage/disengage forms — deterministic
  // regardless of current state, so a macro can drive auto-walk without fighting
  // the toggle's parity (bare `auto` flips whatever state it finds).
  if (lower === 'auto') { toggleAutoWalk(); return true; }
  if (lower === 'auto on') { startAutoWalk(); return true; }
  if (lower === 'auto off') { cancelAutoWalk('Auto-walk stopped.'); return true; }
  // `stop` halts client-side automation — an in-progress auto-walk and/or any
  // running macro. Only when neither is active does it fall through to the
  // server's unified stop (combat, following, plugin actions).
  if (lower === 'stop') {
    const walkStopped = cancelAutoWalk('Auto-walk stopped.');
    const macroStopped = abortMacros();
    if (macroStopped) appendMsg('Macros stopped.', 'system');
    if (walkStopped || macroStopped) return true;
  }
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

// Everything the Enter key does with a finished command line: history, clearing
// the box, the client-verb branch, then the server.
//
// Extracted so voice input (dictation.js) submits through the SAME path rather
// than a parallel one. A second submit path is how a spoken command quietly
// stops answering the auto-walk prompt, or stops being remembered by ArrowUp —
// divergences nobody notices until the person relying on them reports it.
let _submitOpts = {};
export function submitCommand(cmd) {
  const line = String(cmd || '').trim();
  if (!line) return;
  // Acting says you are done listening to the last thing. Without this the only
  // way to skip a long room description being read aloud is to sit through it,
  // and a reader you have to wait out is one you end up fighting.
  shush();
  state.cmdHistory.unshift(line);
  state.historyIdx = -1;
  const input = document.getElementById('cmd-input');
  if (input) input.value = '';
  if (handleClientCommand(line, _submitOpts)) return;
  sendCmd(line);
}

export function initInput({ saveOrigin, notify } = {}) {
  const input = document.getElementById('cmd-input');
  _submitOpts = { saveOrigin, notify };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitCommand(input.value);
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
    // The flight sim owns the keyboard (A/Z throttle, Q/E/S views, R/F flaps, …) — don't
    // yank focus into the command box on those single-key presses.
    if (isFlightSimActive()) return;
    // The cockpit/charter cabin HUD owns the keyboard too (Q/E swivel the passenger
    // view); it focuses its own pane, so don't yank focus back into the command box
    // on the next keystroke — that's what turns a charter ride into command spam.
    if (isCockpitHudActive()) return;
    // The hangar walk-around inspect owns W/A/S/D (its own free camera) — don't steal
    // focus into the command box, or its keydown handler bails on the focused input.
    if (isHangarBayWalkActive()) return;
    // The truck depot's walkaround is the same camera around a rig, and owns the same keys.
    if (isTruckDepotWalkActive()) return;
    // WASD keyboard movement owns the keys while armed — don't pull focus into
    // the command box (the window-capture handler in main.js drives movement).
    if (state.wasdMove) return;
    // The piano owns the letter rows while its keys are live — every one of them
    // is a note. It hands the keyboard back on Escape or on blur, and says so on
    // the panel, so this never traps anyone.
    if (isPianoKeysLive()) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      input.focus();
    }
  });
}
