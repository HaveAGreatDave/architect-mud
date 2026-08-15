// Triggers, timers and input aliases — the automation half of a MUD client.
//
// All three are the SAME idea wearing three hats: something happens, a macro
// script runs. So none of them has a runner of its own — every one of them ends
// at `runMacro()` in smartbar-macros.js, which already owns the step budget, the
// loop pacing, the abort flag, the client-verb routing and `$value`
// interpolation. A second executor here would be a second place for a runaway
// loop to be possible, and the first one took real care to make safe.
//
//   • TRIGGER — a line arrived that matches a pattern.
//   • TIMER   — a wall-clock interval elapsed.
//   • ALIAS   — the player typed something matching a pattern.
//
// ── The thing that makes triggers dangerous ─────────────────────────────────
//
// A trigger fires commands, commands produce lines, and lines fire triggers. That
// is a loop with the server in the middle of it, and it is not hypothetical: the
// first trigger anyone writes is on a combat message, and combat messages are
// what attacking produces. THREE independent guards, because any one of them
// alone has a hole:
//
//   1. RE-ENTRANCY. Lines printed while a trigger chain is running do not fire
//      triggers at all (`_depth`). This kills the direct self-feeding loop, which
//      is the common case, and costs nothing else.
//   2. PER-TRIGGER COOLDOWN. One trigger cannot fire again within its own
//      cooldown, so a burst of six matching lines is one action, not six.
//   3. A GLOBAL BUDGET. More than MAX_FIRES fires inside the window and every
//      trigger is switched OFF and the player is told, loudly. Guard 1 does not
//      catch a loop that goes out through the server and comes back a tick later,
//      and that loop would otherwise run until the tab was closed.
//
// Guard 3 disables rather than throttles on purpose. A throttled runaway is still
// a runaway — it just spams the server slowly and forever, and the player has no
// idea why the game is behaving strangely.
import { appendMsg, setLineObserver } from './render.js';
import { runMacro } from './panels/smartbar-macros.js';
import { state } from './state.js';
import { makeBudget, applyCaptures, compileRow } from './automation-guards.js';

const T_KEY = 'architect_triggers';
const A_KEY = 'architect_input_aliases';
const M_KEY = 'architect_timers';

// ── Stores ──────────────────────────────────────────────────────────────────
//
// Trigger: { id, pattern, regex, cmds, enabled, cooldownMs }
// Alias:   { id, pattern, regex, cmds, enabled }
// Timer:   { id, label, everyMs, cmds, enabled }
//
// `regex` is opt-in per row and OFF by default. Plain patterns are matched as a
// case-insensitive substring, which is what almost everybody means and cannot be
// written wrongly. A regex that fails to compile disables its own row rather than
// throwing on every line thereafter — see compileOne().
function loadJson(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  } catch { return []; }
}

function saveJson(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* quota */ }
}

export function loadTriggers() { return loadJson(T_KEY); }
export function loadAliases() { return loadJson(A_KEY); }
export function loadTimers() { return loadJson(M_KEY); }

function saveTriggers(list) { saveJson(T_KEY, list); compileTriggers(); }
function saveAliases(list) { saveJson(A_KEY, list); compileAliases(); }
function saveTimers(list) { saveJson(M_KEY, list); syncTimers(); }

function genId(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

// ── Compiling ───────────────────────────────────────────────────────────────
//
// Done once per store change, never per line. Triggers are tested against every
// message the client prints, which during a fight is several a second.
//
// A broken regex is caught HERE and the row is marked dead, because the
// alternative is an exception thrown from inside the append path — which would
// take the whole log down, on every line, until a reload. A player writing a
// pattern with an unbalanced bracket is not a rare event.

let _triggers = [];
let _aliases = [];
function compileTriggers() {
  _triggers = loadTriggers().filter(t => t.enabled !== false).map(compileRow).filter(Boolean);
}
function compileAliases() {
  _aliases = loadAliases().filter(a => a.enabled !== false).map(compileRow).filter(Boolean);
}
compileTriggers();
compileAliases();


// ── The runaway guards ──────────────────────────────────────────────────────
const MAX_FIRES = 25;          // …within
const FIRE_WINDOW_MS = 10000;  // …this window, across ALL triggers
const DEFAULT_COOLDOWN_MS = 400;

let _depth = 0;                // >0 while a trigger chain is running
const _budget = makeBudget({ max: MAX_FIRES, windowMs: FIRE_WINDOW_MS });

function disableAllTriggers(why) {
  const list = loadTriggers().map(t => ({ ...t, enabled: false }));
  saveTriggers(list);
  _budget.reset();
  appendMsg(`All triggers switched OFF — ${why}. Fix the pattern and turn them `
    + `back on with "trigger on <name>".`, 'system');
}

const _lastFire = new Map();   // trigger id → when

// Every line the client prints passes through here (render.js). Must stay cheap
// and must never throw: an exception on this path takes the log with it.
// Returns TRUE to suppress the line (a gag). Everything else about it is
// fire-and-forget.
export function feedTriggerLine(text) {
  if (!_triggers.length) return false;
  const line = String(text || '');
  if (!line.trim()) return false;
  const now = Date.now();
  let gag = false;
  for (const t of _triggers) {
    if (t.broken) continue;
    // A gag-only trigger runs no commands, so it cannot loop: it is exempt from
    // the re-entrancy guard and the budget. Without that you could not gag the
    // output of your own triggers, which is much of what gagging is for.
    const inert = t.gagOnly;
    if (_depth > 0 && !inert) continue;
    let m = null;
    try { m = t.test(line); } catch { continue; }
    if (!m) continue;
    if (t.gag) gag = true;
    if (inert) continue;                       // nothing to run
    const cool = Number(t.cooldownMs) || DEFAULT_COOLDOWN_MS;
    if (now - (_lastFire.get(t.id) || 0) < cool) continue;
    if (!_budget.allow()) { disableAllTriggers('too many fired at once (a loop)'); return gag; }
    _lastFire.set(t.id, now);
    fire(applyCaptures(t.cmds, m), `trigger:${t.pattern}`);
  }
  return gag;
}

// The one place every automation path ends up, so the re-entrancy depth is
// impossible to forget to increment. Nothing awaits it — a trigger is
// fire-and-forget by nature, and the runner already bounds itself.
function fire(cmds, label) {
  _depth++;
  const shared = { steps: 0, invRefreshed: false, aborted: false };
  Promise.resolve(runMacro(cmds, { depth: 0, stack: [label], shared }))
    .catch(() => {})
    .finally(() => { _depth = Math.max(0, _depth - 1); });
}

// ── Input aliases ───────────────────────────────────────────────────────────
//
// Applied to what the player typed, before anything else looks at it. Returns the
// rewritten command, or null when nothing matched.
//
// ⚠ ONE PASS ONLY. An alias whose output matches another alias does not expand
// again. Chained expansion is how `k` → `attack $1` → `attack` → … becomes a
// loop in a text box, and the value of chaining is nearly zero next to the cost
// of explaining why the client hung.
export function expandAlias(input) {
  if (!_aliases.length) return null;
  const line = String(input || '');
  for (const a of _aliases) {
    if (a.broken) continue;
    let m = null;
    try { m = a.test(line); } catch { continue; }
    if (!m) continue;
    return applyCaptures(a.cmds, m);
  }
  return null;
}

// ── Timers ──────────────────────────────────────────────────────────────────
//
// ⚠ MIN_INTERVAL_MS is a floor, not a suggestion. A one-second timer firing a
// command is already a request per second forever; anything under that is
// indistinguishable from an attack on your own server, and the player who set it
// would never know.
const MIN_INTERVAL_MS = 1000;
const _handles = new Map();    // timer id → interval handle

function syncTimers() {
  for (const [id, h] of _handles) { clearInterval(h); _handles.delete(id); }
  for (const t of loadTimers()) {
    if (t.enabled === false || !t.cmds) continue;
    const every = Math.max(MIN_INTERVAL_MS, Number(t.everyMs) || 0);
    _handles.set(t.id, setInterval(() => {
      // Not while logged out, and not while a trigger chain is mid-flight — a
      // timer landing inside one would run its commands under the re-entrancy
      // guard and confuse both.
      if (!state.player || _depth > 0) return;
      fire(t.cmds, `timer:${t.label || t.id}`);
    }, every));
  }
}

// Called by `stop` and the smartbar Stop chip: stopping automation must stop the
// thing that RESTARTS it, or `stop` reads as broken. Timers are switched off
// (persisted), not merely unscheduled, so a reload doesn't bring them back.
export function stopAllTimers() {
  const list = loadTimers();
  const running = list.filter(t => t.enabled !== false).length;
  if (!running) return 0;
  saveTimers(list.map(t => ({ ...t, enabled: false })));
  return running;
}

export function initAutomation() {
  syncTimers();
  // Register rather than let render.js import this file — see setLineObserver().
  setLineObserver(feedTriggerLine);
}

// ── Verbs ───────────────────────────────────────────────────────────────────
//
// `trigger`, `alias` and `timer` share one grammar, because three surfaces with
// three grammars is three things to remember for one idea:
//
//   <verb>                        list them
//   <verb> <pattern> = <script>   add or replace
//   <verb> off <pattern>          remove
//   <verb> on|off all             enable / disable the lot
//
// A pattern wrapped in / / is a regex; anything else is a plain substring. That
// is the only syntax in it, and it is the one convention every client in this
// genre already uses.
function parsePattern(raw) {
  const s = String(raw).trim();
  const m = s.match(/^\/(.+)\/$/);
  return m ? { pattern: m[1], regex: true } : { pattern: s, regex: false };
}

function describe(row) {
  const off = row.enabled === false ? ' (off)' : '';
  const kind = row.regex ? '/' + row.pattern + '/' : row.pattern;
  return `  ${kind}${off}  →  ${row.cmds}`;
}

function listOrManage(rest, { load, save, noun, extra }) {
  const arg = String(rest || '').trim();
  const list = load();

  if (!arg) {
    if (!list.length) { appendMsg(`No ${noun}s set. ${extra}`, 'system'); return; }
    appendMsg(`${list.length} ${noun}(s):\n` + list.map(describe).join('\n'), 'system');
    return;
  }
  let m = arg.match(/^(on|off)\s+all$/i);
  if (m) {
    const on = m[1].toLowerCase() === 'on';
    save(list.map(r => ({ ...r, enabled: on })));
    appendMsg(`All ${noun}s ${on ? 'on' : 'off'}.`, 'system');
    return;
  }
  m = arg.match(/^(on|off)\s+(.+)$/i);
  if (m) {
    const on = m[1].toLowerCase() === 'on';
    const { pattern } = parsePattern(m[2]);
    const row = list.find(r => r.pattern.toLowerCase() === pattern.toLowerCase());
    if (!row) { appendMsg(`No ${noun} matching "${pattern}".`, 'system'); return; }
    if (on) {
      save(list.map(r => (r.id === row.id ? { ...r, enabled: true } : r)));
      appendMsg(`${noun} on: ${row.pattern}`, 'system');
    } else {
      // `off <pattern>` REMOVES rather than disables, and `on all`/`off all`
      // toggle. Deleting is what people mean when they name one thing, and the
      // toggle is there for the times they don't.
      save(list.filter(r => r.id !== row.id));
      appendMsg(`Removed ${noun}: ${row.pattern}`, 'system');
    }
    return;
  }
  const eq = arg.indexOf('=');
  if (eq === -1) {
    appendMsg(`Usage: ${noun} <pattern> = <commands>   ·   ${noun} off <pattern>   ·   ${noun} on|off all`, 'system');
    return;
  }
  const { pattern, regex } = parsePattern(arg.slice(0, eq));
  const cmds = arg.slice(eq + 1).trim();
  if (!pattern || !cmds) { appendMsg(`Both a pattern and commands are needed.`, 'system'); return; }
  if (regex) {
    try { new RegExp(pattern, 'i'); }
    catch (e) { appendMsg(`That regex doesn't compile: ${e.message}`, 'system'); return; }
  }
  const without = list.filter(r => r.pattern.toLowerCase() !== pattern.toLowerCase());
  without.push({ id: genId(noun[0]), pattern, regex, cmds, enabled: true });
  save(without);
  appendMsg(`${noun} set: ${regex ? '/' + pattern + '/' : pattern} → ${cmds}`, 'system');
}

export function runTriggerCommand(rest) {
  listOrManage(rest, {
    load: loadTriggers, save: saveTriggers, noun: 'trigger',
    extra: 'Try:  trigger you are bleeding = bandage   ·   trigger picks its nose = gag',
  });
}

export function runAliasCommand(rest) {
  listOrManage(rest, {
    load: loadAliases, save: saveAliases, noun: 'alias',
    extra: 'Try:  alias /^k (.+)$/ = attack $1',
  });
}

// Timers don't fit the pattern grammar — there is no pattern, there is an
// interval — so this one is its own small parser rather than being forced through
// the shared one.
export function runTimerCommand(rest) {
  const arg = String(rest || '').trim();
  const list = loadTimers();
  if (!arg) {
    if (!list.length) { appendMsg('No timers set. Try:  timer 30s = look', 'system'); return; }
    appendMsg(`${list.length} timer(s):\n` + list.map(t =>
      `  every ${Math.round((t.everyMs || 0) / 1000)}s${t.enabled === false ? ' (off)' : ''}  →  ${t.cmds}`
    ).join('\n'), 'system');
    return;
  }
  if (/^off\s+all$/i.test(arg) || /^off$/i.test(arg)) {
    const n = stopAllTimers();
    appendMsg(n ? `Stopped ${n} timer(s).` : 'No timers were running.', 'system');
    return;
  }
  if (/^clear$/i.test(arg)) { saveTimers([]); appendMsg('All timers removed.', 'system'); return; }
  const m = arg.match(/^(\d+)\s*(ms|s|m)?\s*=\s*(.+)$/i);
  if (!m) {
    appendMsg('Usage: timer <interval> = <commands>   e.g.  timer 30s = look   ·   timer off   ·   timer clear', 'system');
    return;
  }
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const everyMs = unit === 'ms' ? n : unit === 'm' ? n * 60000 : n * 1000;
  if (everyMs < MIN_INTERVAL_MS) {
    appendMsg(`The shortest timer is ${MIN_INTERVAL_MS / 1000}s — anything faster is a command every `
      + `tick, forever, which is not something you want running by accident.`, 'system');
    return;
  }
  list.push({ id: genId('t'), label: `${n}${unit}`, everyMs, cmds: m[3].trim(), enabled: true });
  saveTimers(list);
  appendMsg(`Timer set: every ${Math.round(everyMs / 1000)}s → ${m[3].trim()}. "timer off" stops the lot.`, 'system');
}
