import { state } from './state.js';
import { sendCmd } from './net.js';
import { appendHtml, appendMsg, releaseScrollLock } from './render.js';
import { MARKUP_HELP_HTML, STATUS_TEMPLATE } from './markup.js';
import { appendToWhisperLog, sendToActiveTab } from './panels/whisper.js';
import { openMusicPlayerPanel } from './panels/musicplayer.js';
import { DISCORD_INVITE } from './panels/tablet-os.js';
import { isFlightSimActive, isCockpitHudActive } from './panels/cockpit.js';
import { isHangarBayWalkActive } from './panels/hangar-bay.js';
import { isTruckDepotWalkActive } from './panels/truck-depot.js';
import { isPianoKeysLive } from './panels/piano.js';
// THE CAB owns A/Z/X/C, the arrows, the comma and the full stop — nearly the whole letter row.
// Without this guard every one of them is also a printable character, so the auto-focus below
// pulled the caret into the command box on the first press and the rest of the drive went into it
// as 'aaaaaaaaazzzzzzzz'. Every other panel that owns the keyboard is already listed here; the cab
// was the one that never was.
import { isCabActive } from './panels/cab-view.js';
import { toggleAutoWalk, startAutoWalk, cancelAutoWalk, isAutoWalkPromptPending, answerAutoWalkPrompt } from './panels/minimap.js';
import { runMacroByName, runMacroByKey, runMacro, abortMacros } from './panels/smartbar-macros.js';
import { runAccessibilityCommand } from './a11y-command.js';
import { shush } from './logreader.js';
import { completeInput, resetCompletion } from './complete.js';
import { runHighlightCommand, openFindBar, exportTranscript } from './logtools.js';
import { runTriggerCommand, runAliasCommand, runTimerCommand, expandAlias, stopAllTimers } from './automation.js';
import { runVarsCommand } from './varscommand.js';
// The verbs whose arguments are a sentence a human wrote. Imported rather than
// restated: command stacking needs exactly the judgement this list already makes,
// and a second copy would drift into eating somebody's chat message.
import { FREE_TEXT_VERBS } from '/shared/dictation.js';

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
  // `discord` — the invite, as a line in the log. Client-side for the same reason
  // `accessibility` is: it is a link to somewhere outside the game, so the server
  // has nothing to say about it and a round trip would only add a way to fail. The
  // URL is imported rather than retyped so the tablet's Discord page and this verb
  // can never drift apart. A real anchor, not a `data-cmd` action-link — those run
  // commands; this one leaves.
  if (lower === 'discord') {
    appendHtml(`<div class="system">The Basin has a bar: `
      + `<a href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">${DISCORD_INVITE}</a><br>`
      + `<span style="color:var(--text-dim)">Who is about right now is on the tablet: Settings → Discord.</span></div>`);
    return true;
  }
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
  // ── The log tools ─────────────────────────────────────────────────────────
  //
  // Client-side because they act on the log the browser is holding, which the
  // server has no copy of and no business having one of.
  //
  // ⚠ `highlight`, `hl` and `find` are BARE verbs, which means they shadow any
  // server verb of the same name forever — a client verb never reaches dispatch.
  // All three were checked against the live registries (builtins, aliases, every
  // plugin's command array) before being taken. Note `search` was NOT free — the
  // strays plugin owns it — which is why finding in the log is `find`.
  if (lower === 'highlight' || lower.startsWith('highlight ') ||
      lower === 'hl' || lower.startsWith('hl ')) {
    runHighlightCommand(cmd.replace(/^\S+\s*/, ''));
    return true;
  }
  if (lower === 'find' || lower.startsWith('find ')) {
    openFindBar(cmd.slice(4).trim());
    return true;
  }
  // Dot-prefixed like `.markup` and `.status`: a client-only meta command with no
  // in-world meaning, kept out of the plain verb namespace on purpose.
  if (lower === '.savelog') { exportTranscript(); return true; }
  // Automation. Same collision rule as the log tools above — all four were
  // checked against the live registries and none is claimed by the engine or any
  // plugin. `set`/`unset` are deliberately NOT client verbs: they are macro-script
  // segments (smartbar-macros.js classify()), so `set` typed at the box is still
  // free for the game to use one day.
  if (lower === 'trigger' || lower.startsWith('trigger ') ||
      lower === 'triggers' || lower.startsWith('triggers ')) {
    runTriggerCommand(cmd.replace(/^\S+\s*/, ''));
    return true;
  }
  if (lower === 'alias' || lower.startsWith('alias ') ||
      lower === 'aliases' || lower.startsWith('aliases ')) {
    runAliasCommand(cmd.replace(/^\S+\s*/, ''));
    return true;
  }
  if (lower === 'timer' || lower.startsWith('timer ') ||
      lower === 'timers' || lower.startsWith('timers ')) {
    runTimerCommand(cmd.replace(/^\S+\s*/, ''));
    return true;
  }
  if (lower === 'vars' || lower.startsWith('vars ')) {
    runVarsCommand(cmd.replace(/^\S+\s*/, ''));
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
    // Timers too, and switched OFF rather than merely unscheduled. `stop` that
    // leaves the thing which RESTARTS the automation running reads as broken —
    // the commands come back three seconds later and nothing explains why.
    const timersStopped = stopAllTimers();
    if (macroStopped) appendMsg('Macros stopped.', 'system');
    if (timersStopped) appendMsg(`${timersStopped} timer(s) stopped.`, 'system');
    if (walkStopped || macroStopped || timersStopped) return true;
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
  // …and for the same reason, acting says you are done reading back: snap the log
  // to the tail and start following again. Otherwise the answer to the command you
  // just typed lands somewhere below the fold and the game looks like it ignored you.
  releaseScrollLock();
  // ⚠ HISTORY REMEMBERS WHAT WAS TYPED, not what it expanded to. ArrowUp giving
  // you back `attack the rusted enforcer` when you typed `k enf` makes the alias
  // useless the second time — the whole point of it is the short form.
  state.cmdHistory.unshift(line);
  state.historyIdx = -1;
  const input = document.getElementById('cmd-input');
  if (input) input.value = '';
  // Aliases rewrite the line before anything else sees it, so an alias can expand
  // to a client verb (`k` → `macro fight`) as readily as to a server one. One
  // pass, no re-expansion — see expandAlias().
  //
  // An alias may expand to a `;`-chained script, which is why this hands off to
  // the macro runner rather than to sendCmd: a single command is a one-segment
  // script, and routing both through one path means an alias and a macro cannot
  // drift apart in what they support.
  const aliased = expandAlias(line);
  const effective = aliased === null ? line : aliased;
  if (isStacked(effective)) { runMacro(effective, null); return; }
  const single = effective.replace(/;;/g, ';');
  if (handleClientCommand(single, _submitOpts)) return;
  sendCmd(single);
}

// ── Command stacking ────────────────────────────────────────────────────────
//
// `n;n;e` is three commands. The oldest convenience in the genre, and the one
// this client conspicuously lacked: `;` worked inside a macro and nowhere else,
// so typing it at the box sent one nonsense string to the server.
//
// ⚠ The trap is `say meet me at the bar; I'll be late`. Splitting that turns half
// of somebody's sentence into a command, and it is the single commonest thing a
// player types with a semicolon in it. So free-text verbs are NEVER split — and
// the list of them is not written here, it is FREE_TEXT_VERBS from the shared
// dictation module, which exists for exactly this judgement ("everything after
// these is a sentence a human wrote"). Two copies of that list would drift, and
// the drift would show up as a player's chat message being eaten.
//
// ⚠ `;;` anywhere is a LINE-LEVEL escape: the line is not split at all, and each
// `;;` collapses to one `;`. Deliberately NOT a per-separator escape, which is what
// it looks like it ought to be — the macro runner splits the script itself, so an
// escaped semicolon smuggled through inside a segment would just be split by
// `runMacro` a moment later and the escape would silently not work. A line-level
// switch is the version that is actually true.
export function isStacked(line) {
  const verb = String(line).trim().split(/\s+/)[0].toLowerCase();
  if (FREE_TEXT_VERBS.has(verb)) return false;
  if (String(line).includes(';;')) return false;
  return String(line).includes(';');
}

export function initInput({ saveOrigin, notify } = {}) {
  const input = document.getElementById('cmd-input');
  _submitOpts = { saveOrigin, notify };

  // Any ordinary edit retires a running completion cycle (complete.js rule 3).
  input.addEventListener('input', resetCompletion);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitCommand(input.value);
    } else if (e.key === 'Tab') {
      // preventDefault ONLY when something was completed. An empty box, or a word
      // nothing matches, lets Tab do what Tab does and move focus out — a command
      // box you cannot leave by keyboard is a keyboard trap, and this one sits in
      // front of every other control on the page.
      if (completeInput(input, e.shiftKey)) e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.historyIdx < state.cmdHistory.length - 1) { state.historyIdx++; input.value = state.cmdHistory[state.historyIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.historyIdx > 0) { state.historyIdx--; input.value = state.cmdHistory[state.historyIdx]; }
      else { state.historyIdx = -1; input.value = ''; }
    }
  });

  // ── Macro key bindings ────────────────────────────────────────────────────
  //
  // F1–F9 and the numpad, bound per macro in the manager. Its own listener rather
  // than a branch of the auto-focus one below, because the guards are different in
  // both directions: a macro key SHOULD fire while the caret is in the command box
  // (that is the point — you are typing and you hit F3), and must NOT fire while a
  // panel owns the keyboard.
  //
  // The flight sim and the cab are checked because their keys are the letter row,
  // not the F-row — but a panel that has taken the keyboard has taken it, and a
  // macro walking the player home mid-landing is not a feature.
  document.addEventListener('keydown', (e) => {
    if (!/^(F[1-9]|Numpad[0-9])$/.test(e.code)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;   // browser/OS combinations
    if (document.getElementById('auth-screen')?.style.display !== 'none') return;
    if (isFlightSimActive() || isCockpitHudActive() || isHangarBayWalkActive()
      || isTruckDepotWalkActive() || isCabActive() || isPianoKeysLive()) return;
    // NumLock off sends Numpad codes for the arrows and Home/End; honouring those
    // would fire a macro when somebody meant to move the caret.
    if (e.code.startsWith('Numpad') && e.key.length !== 1) return;
    if (runMacroByKey(e.code)) e.preventDefault();
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
    // …and driving the thing is the same claim as walking round it.
    if (isCabActive()) return;
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
