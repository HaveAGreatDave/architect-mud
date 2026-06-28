import { state } from './state.js';
import { sendCmd } from './net.js';
import { appendHtml } from './render.js';

const MARKUP_HELP = `
<div style="font-family:var(--font-mono);font-size:12px;line-height:1.8;color:var(--text)">
  <div style="color:var(--accent);margin-bottom:4px">── Whisper Markup ──────────────────</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[b]text[/b]</span> <strong>bold</strong></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[i]text[/i]</span> <em>italic</em></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[u]text[/u]</span> <span style="text-decoration:underline">underline</span></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[s]text[/s]</span> <span style="text-decoration:line-through">strikethrough</span></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[color=red]text[/color]</span> <span style="color:red">colored text</span> (named or #rrggbb)</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[player]Name[/player]</span> <span style="color:var(--purple)">player name style</span></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[item]Sword[/item]</span> <span style="color:var(--yellow)">item name style</span></div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">[system]text[/system]</span> <span style="color:var(--text-dim)">system text style</span></div>
  <div style="color:var(--accent);margin-top:6px;margin-bottom:2px">── Variables (your stats at send time) ──</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$name</span> your handle</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$hp / $maxhp</span> current &amp; max health</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$san</span> sanity</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$rad</span> radiation level</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$temp</span> body temperature</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$credits</span> credits on hand</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$ip</span> improvement points</div>
  <div><span style="color:var(--yellow);min-width:220px;display:inline-block">$zone</span> current location name</div>
  <div style="color:var(--text-dim);margin-top:4px;font-size:11px">Markup and variables apply in whisper and channel messages only.</div>
</div>`.trim();

function handleClientCommand(cmd) {
  if (cmd.toLowerCase() === '.markup') {
    appendHtml(MARKUP_HELP);
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
