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
import { appendMsg, setLineObserver, setStateObserver, setPaneWriter } from './render.js';
import { runMacro } from './panels/smartbar-macros.js';
import { state } from './state.js';
import { makeBudget, applyCaptures, compileRow, splitPrefixes } from './automation-guards.js';
import { offerLine, cancelAllWaits } from './linewait.js';
import { writeToPanes, reconcilePanes } from './panes.js';
import { evalBool, isWellFormed } from './expr.js';
import { registerConfig, markConfigDirty } from './configsync.js';

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

// Each save marks its key dirty; configsync.js owns the debounce, the stamp and
// the conflict rule. Nothing here compares a timestamp.
function saveTriggers(list) { saveJson(T_KEY, list); compileTriggers(); markConfigDirty('triggers'); }
function saveAliases(list) { saveJson(A_KEY, list); compileAliases(); markConfigDirty('aliases'); }
function saveTimers(list) { saveJson(M_KEY, list); syncTimers(); markConfigDirty('timers'); }

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
// ── The multi-line window ───────────────────────────────────────────────────
//
// The last few lines printed, so a trigger can match a pattern spread across
// them. Ten deep because that is the row cap; a longer memory would only let
// somebody write a rule matching two things a paragraph apart, which is not what
// this is for.
//
// ⚠ Each multi-line row remembers the sequence number it last matched at, and
// will not fire again until the window has moved past it. Without that, a
// three-line pattern matches on the line that completes it AND on the next two
// lines that still contain it — three fires for one event. The cooldown would
// mask that at normal speed and not during a burst, which is the worst kind of
// half-working.
const WINDOW = 10;
const _recent = [];
let _seq = 0;
const _lastWindowSeq = new Map();   // trigger id → seq it last matched at

export function feedTriggerLine(text, cls) {
  const line = String(text || '');
  // Parked scripts are woken FIRST and unconditionally — a `wait for` is not a
  // trigger, has no budget and no cooldown, and must not be suppressed by the
  // re-entrancy guard: waiting for the result of a command a trigger just fired
  // is the ordinary case, not an edge one.
  offerLine(line, cls);
  if (!line.trim()) return false;
  _seq++;
  _recent.push({ text: line, cls, seq: _seq });
  if (_recent.length > WINDOW) _recent.shift();
  const routed = routeFor(line, cls);
  if (!_triggers.length) return routed ? { gag: routed.gag, panes: routed.panes } : false;
  const now = Date.now();
  let gag = routed ? routed.gag : false;
  for (const t of _triggers) {
    if (t.broken) continue;
    // A gag-only trigger runs no commands, so it cannot loop: it is exempt from
    // the re-entrancy guard and the budget. Without that you could not gag the
    // output of your own triggers, which is much of what gagging is for.
    const inert = t.gagOnly;
    if (_depth > 0 && !inert) continue;

    let subject = line;
    if (t.lines > 1) {
      const win = _recent.slice(-t.lines);
      // Not enough history yet — a three-line rule cannot match on line two.
      if (win.length < t.lines) continue;
      // Already fired on a window ending at or after this one's start.
      if ((_lastWindowSeq.get(t.id) || 0) >= win[0].seq) continue;
      subject = win.map(w => w.text).join('\n');
    }

    let m = null;
    try { m = t.test(subject, cls); } catch { continue; }
    if (!m) continue;
    // ⚠ A multi-line GAG hides only the line that completed the match. Hiding the
    // whole window is impossible — the earlier lines are already mounted and the
    // suppression seam decides before mounting — and quietly hiding some of them
    // some of the time would be worse than the honest single line.
    if (t.gag) gag = true;
    if (t.lines > 1) _lastWindowSeq.set(t.id, _seq);
    if (inert) continue;                       // nothing to run
    const cool = Number(t.cooldownMs) || DEFAULT_COOLDOWN_MS;
    if (now - (_lastFire.get(t.id) || 0) < cool) continue;
    if (!_budget.allow()) { disableAllTriggers('too many fired at once (a loop)'); return { gag, panes: routed ? routed.panes : null }; }
    _lastFire.set(t.id, now);
    fire(applyCaptures(t.cmds, m), `trigger:${t.pattern}`);
    // A one-shot retires from the STORE, not just from this pass — same rule as
    // a one-shot timer. One that survived would come back on the next reload and
    // fire on a line nobody connected to it.
    if (t.once) saveTriggers(loadTriggers().filter(x => x.id !== t.id));
  }
  return (routed || gag) ? { gag, panes: routed ? routed.panes : null } : false;
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

// ── Output routing ──────────────────────────────────────────────────────────
//
// `route @say = Chat` copies every `say` line into a pane called Chat.
// `route @say = Chat only` moves it there instead — out of the main log.
//
// Reuses the trigger grammar exactly (pattern on the left, `@channel`/`#group`
// prefixes, `/regex/`), because a route is a trigger whose action is "put it over
// there". The right-hand side is a pane NAME rather than a script, which is the
// only difference and is why it gets its own store rather than a flag on a
// trigger row: a rule that both fires commands and moves a line would need two
// grammars on one side of the `=`.
const R_KEY = 'architect_routes';
export function loadRoutes() { return loadJson(R_KEY); }
function saveRoutes(list) {
  saveJson(R_KEY, list);
  compileRoutes();
  markConfigDirty('routes');
  reconcilePanes(loadRoutes().map(r => r.pane));
}

let _routes = [];
function compileRoutes() {
  _routes = loadRoutes().filter(r => r.enabled !== false).map(compileRow).filter(Boolean);
}
compileRoutes();

// Returns { panes, gag } for one line. Cheap and never throws — same path as
// triggers, same rules.
function routeFor(line, cls) {
  if (!_routes.length) return null;
  let panes = null, gag = false;
  for (const r of _routes) {
    if (r.broken) continue;
    let m = null;
    try { m = r.test(line, cls); } catch { continue; }
    if (!m) continue;
    (panes ||= []).push(r.pane);
    if (r.only) gag = true;
  }
  return panes ? { panes, gag } : null;
}

export function runRouteCommand(rest) {
  const arg = String(rest || '').trim();
  const list = loadRoutes();
  if (!arg) {
    if (!list.length) {
      appendMsg('No routes. These copy matching lines into their own small window:\n'
        + '  route @say = Chat          · a copy, the line stays in the log\n'
        + '  route @say = Chat only     · moves it, out of the log\n'
        + '  route off @say             · stop routing', 'system');
      return;
    }
    appendMsg(`${list.length} route(s):\n` + list.map(r =>
      `  ${r.channel ? '@' + r.channel + ' ' : ''}${r.pattern || '(any line)'}`
      + `${r.enabled === false ? ' (off)' : ''}  →  ${r.pane}${r.only ? ' only' : ''}`).join('\n'), 'system');
    return;
  }
  if (/^(off|clear)\s+all$/i.test(arg) || /^clear$/i.test(arg)) {
    saveRoutes([]);
    appendMsg(list.length ? `Removed ${list.length} route(s).` : 'There were none.', 'system');
    return;
  }
  let m = arg.match(/^off\s+(.+)$/i);
  if (m) {
    const { pattern, channel } = parsePattern(m[1]);
    const row = list.find(r => (r.pattern || '').toLowerCase() === pattern.toLowerCase()
      && (!channel || (r.channel || null) === channel));
    if (!row) { appendMsg(`No route matching "${pattern}".`, 'system'); return; }
    saveRoutes(list.filter(r => r.id !== row.id));
    appendMsg(`Route removed: ${row.pane}`, 'system');
    return;
  }
  const eq = arg.indexOf('=');
  if (eq === -1) {
    appendMsg('Usage: route [@channel] <pattern> = <Pane> [only]   ·   route off <pattern>   ·   route clear', 'system');
    return;
  }
  const { pattern, regex, channel } = parsePattern(arg.slice(0, eq));
  let dest = arg.slice(eq + 1).trim();
  const only = /\bonly$/i.test(dest);
  if (only) dest = dest.replace(/\s*only$/i, '').trim();
  if ((!pattern && !channel) || !dest) { appendMsg('A pattern and a pane name are needed.', 'system'); return; }
  // A pane name is a label on a window, so it stays short and printable rather
  // than being an identifier — it is read, never typed at a command.
  if (dest.length > 24) { appendMsg('That pane name is too long (24 characters).', 'system'); return; }
  if (regex) {
    try { new RegExp(pattern, 'i'); }
    catch (e) { appendMsg(`That regex doesn't compile: ${e.message}`, 'system'); return; }
  }
  const same = (r) => (r.pattern || '').toLowerCase() === pattern.toLowerCase()
    && (r.channel || null) === (channel || null);
  const without = list.filter(r => !same(r));
  without.push({ id: genId('r'), pattern, regex, channel, pane: dest, only, enabled: true });
  saveRoutes(without);
  appendMsg(`Routing ${channel ? '@' + channel + ' ' : ''}${pattern || '(any line)'} → ${dest}`
    + `${only ? ' (moved out of the log)' : ' (copied)'}`, 'system');
}

// ── State triggers ──────────────────────────────────────────────────────────
//
// `on hp_pct < 30 = drink stim`. The condition is an ordinary macro expression
// (expr.js), evaluated against the live player whenever vitals change.
//
// On a traditional MUD this is done by regex-matching a prompt line, because a
// prompt is all a third-party client is given. Here the vitals arrive as
// structured data, so this reads numbers instead of scraping them — which is the
// whole advantage of owning both ends, and the reason this is a separate feature
// rather than "a trigger with a clever pattern".
//
// ⚠ EDGE-TRIGGERED, NOT LEVEL-TRIGGERED. It fires on the transition from false to
// true, and will not fire again until the condition has gone false in between.
// Level-triggered would fire `drink stim` on every single vitals update for as
// long as you stayed under 30 — which is every swing of a fight, and is the
// difference between a useful feature and an automatic way to drink your entire
// inventory.
const S_KEY = 'architect_state_triggers';
export function loadStateTriggers() { return loadJson(S_KEY); }
function saveStateTriggers(list) { saveJson(S_KEY, list); _armed.clear(); markConfigDirty('state_rules'); }

// id → was the condition true last time we looked. Cleared whenever the rules
// change, so an edited rule starts disarmed rather than inheriting the old one's
// idea of "already fired".
const _armed = new Map();

function stateResolver(p) {
  return {
    lookup: (name) => {
      const v = p?.[String(name).toLowerCase()];
      return (v === undefined || v === null) ? null : v;
    },
  };
}

export function feedPlayerState(p) {
  const rows = loadStateTriggers();
  if (!rows.length || !p) return;
  const res = stateResolver(p);
  for (const r of rows) {
    if (r.enabled === false) continue;
    const now = evalBool(r.cond, res);
    const before = _armed.get(r.id) === true;
    _armed.set(r.id, now);
    if (!now || before) continue;              // only the rising edge
    if (_depth > 0) continue;                  // not from inside a trigger chain
    if (!_budget.allow()) { disableAllTriggers('too many fired at once (a loop)'); return; }
    fire(r.cmds, `on:${r.cond}`);
  }
}

export function runStateCommand(rest) {
  const arg = String(rest || '').trim();
  const list = loadStateTriggers();
  if (!arg) {
    if (!list.length) {
      appendMsg('No state rules. These watch your vitals rather than the text — try:\n'
        + '  on hp_pct < 30 = drink stim\n'
        + '  on thirst < 20 = drink water', 'system');
      return;
    }
    appendMsg(`${list.length} state rule(s):\n` + list.map(r =>
      `  when ${r.cond}${r.enabled === false ? ' (off)' : ''}  →  ${r.cmds}`).join('\n'), 'system');
    return;
  }
  if (/^(off|clear)$/i.test(arg)) {
    saveStateTriggers([]);
    appendMsg(list.length ? `Removed ${list.length} state rule(s).` : 'There were none.', 'system');
    return;
  }
  const eq = arg.indexOf('=');
  if (eq === -1) { appendMsg('Usage: on <condition> = <commands>   ·   on clear', 'system'); return; }
  const cond = arg.slice(0, eq).trim();
  const cmds = arg.slice(eq + 1).trim();
  if (!cond || !cmds) { appendMsg('Both a condition and commands are needed.', 'system'); return; }
  // Checked at authoring time. A condition that cannot parse would silently never
  // fire, and the player would have no way to tell that from one that simply has
  // not happened yet.
  if (!isWellFormed(cond)) { appendMsg(`That condition doesn't read: "${cond}"`, 'system'); return; }
  const without = list.filter(r => r.cond.toLowerCase() !== cond.toLowerCase());
  without.push({ id: genId('s'), cond, cmds, enabled: true });
  saveStateTriggers(without);
  appendMsg(`State rule set: when ${cond} → ${cmds}`, 'system');
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
  for (const [id, h] of _handles) { clearInterval(h); clearTimeout(h); _handles.delete(id); }
  for (const t of loadTimers()) {
    if (t.enabled === false || !t.cmds) continue;
    const every = Math.max(MIN_INTERVAL_MS, Number(t.everyMs) || 0);
    const run = () => {
      // Not while logged out, and not while a trigger chain is mid-flight — a
      // timer landing inside one would run its commands under the re-entrancy
      // guard and confuse both.
      if (!state.player || _depth > 0) return;
      fire(t.cmds, `timer:${t.label || t.id}`);
    };
    if (t.once) {
      // ⚠ A one-shot RETIRES ITSELF from the store when it fires, not merely from
      // the schedule. `timer after 30s = look` that survived in the list would
      // come back on the next reload and fire again, half an hour later, with
      // nothing to explain it — which is the behaviour of a bug, not a timer.
      _handles.set(t.id, setTimeout(() => {
        run();
        saveTimers(loadTimers().filter(x => x.id !== t.id));
      }, every));
    } else {
      _handles.set(t.id, setInterval(run, every));
    }
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

// `stop` must also wake anything parked on a `wait for`. A script left waiting
// after the player said stop fires its next command whenever the line eventually
// arrives — minutes later, in a completely different situation.
export function cancelWaits() { return cancelAllWaits(); }

export function initAutomation() {
  syncTimers();
  // Register rather than let render.js import this file — see setLineObserver().
  setLineObserver(feedTriggerLine);
  setStateObserver(feedPlayerState);
  setPaneWriter(writeToPanes);
  reconcilePanes(loadRoutes().map(r => r.pane));

  // ⚠ `replace` writes the raw store WITHOUT going through the save helpers,
  // then does the same side effects by hand. Calling saveTriggers() here would
  // mark the key dirty and push the server's own list straight back at it — a
  // write on every login, and a stamp that moves for no edit.
  registerConfig('triggers', {
    load: loadTriggers,
    replace: (p) => { saveJson(T_KEY, Array.isArray(p) ? p : []); compileTriggers(); },
  });
  registerConfig('aliases', {
    load: loadAliases,
    replace: (p) => { saveJson(A_KEY, Array.isArray(p) ? p : []); compileAliases(); },
  });
  registerConfig('timers', {
    load: loadTimers,
    replace: (p) => { saveJson(M_KEY, Array.isArray(p) ? p : []); syncTimers(); },
  });
  registerConfig('routes', {
    load: loadRoutes,
    replace: (p) => { saveJson(R_KEY, Array.isArray(p) ? p : []); compileRoutes(); reconcilePanes(loadRoutes().map(r => r.pane)); },
  });
  registerConfig('state_rules', {
    load: loadStateTriggers,
    replace: (p) => { saveJson(S_KEY, Array.isArray(p) ? p : []); _armed.clear(); },
  });
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
  // Leading `@channel` and `#group` prefixes, in either order; the rest is the
  // pattern as before, and may be empty (match every line on that channel).
  const { channel, group, rest } = splitPrefixes(raw);
  const m = rest.match(/^\/(.+)\/$/);
  return m
    ? { pattern: m[1], regex: true, channel, group }
    : { pattern: rest, regex: false, channel, group };
}

function describe(row) {
  const bits = [];
  if (row.channel) bits.push(`@${row.channel}`);
  if (row.group) bits.push(`#${row.group}`);
  if (row.lines > 1) bits.push(`${row.lines}ln`);
  if (row.once) bits.push('once');
  const tags = bits.length ? bits.join(' ') + ' ' : '';
  const off = row.enabled === false ? ' (off)' : '';
  const kind = row.pattern ? (row.regex ? '/' + row.pattern + '/' : row.pattern) : '(any line)';
  return `  ${tags}${kind}${off}  →  ${row.cmds}`;
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
  // `on #combat` / `off #combat` — the whole group at once. This is the middle
  // unit the surface was missing: before it, the only choices were one row and
  // every row, and anybody with twenty rules wants to switch a set.
  //
  // ⚠ A group switch DISABLES, it never deletes — unlike `off <pattern>`, which
  // removes. Deleting is a reasonable reading of "off" for a thing you just named
  // in full; it is a terrible one for a set of eleven rules you cannot see.
  m = arg.match(/^(on|off)\s+#([a-z][a-z0-9-]*)$/i);
  if (m) {
    const on = m[1].toLowerCase() === 'on';
    const group = m[2].toLowerCase();
    const hits = list.filter(r => (r.group || '') === group);
    if (!hits.length) { appendMsg(`No ${noun}s in group #${group}.`, 'system'); return; }
    save(list.map(r => ((r.group || '') === group ? { ...r, enabled: on } : r)));
    appendMsg(`${hits.length} ${noun}(s) in #${group} switched ${on ? 'on' : 'off'}.`, 'system');
    return;
  }
  m = arg.match(/^(on|off)\s+(.+)$/i);
  if (m) {
    const on = m[1].toLowerCase() === 'on';
    const { pattern, channel } = parsePattern(m[2]);
    const row = list.find(r => (r.pattern || '').toLowerCase() === pattern.toLowerCase()
      && (!channel || (r.channel || null) === channel));
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
    appendMsg(`Usage: ${noun} [@channel] [#group] [once] [Nln] <pattern> = <commands>\n`
      + `       ${noun} off <pattern>   ·   ${noun} on|off #group   ·   ${noun} on|off all`, 'system');
    return;
  }
  let head = arg.slice(0, eq).trim();
  // `once` and `<N>ln` are word-flags rather than more sigils: there are already
  // two prefix characters, and a third and fourth would turn the front of every
  // rule into punctuation nobody can read back.
  let once = false, lines = 1;
  for (;;) {
    let mm = head.match(/^once\s+([\s\S]*)$/i);
    if (mm) { once = true; head = mm[1].trim(); continue; }
    mm = head.match(/^(\d+)\s*(?:ln|lines)\s+([\s\S]*)$/i);
    if (mm) { lines = Math.max(1, Math.min(10, Number(mm[1]))); head = mm[2].trim(); continue; }
    break;
  }
  const { pattern, regex, channel, group } = parsePattern(head);
  const cmds = arg.slice(eq + 1).trim();
  // A channel on its own is a complete rule ("every loot line"), so the pattern
  // may be empty — but only then.
  if ((!pattern && !channel) || !cmds) { appendMsg(`Both a pattern and commands are needed.`, 'system'); return; }
  if (regex) {
    try { new RegExp(pattern, lines > 1 ? 'is' : 'i'); }
    catch (e) { appendMsg(`That regex doesn't compile: ${e.message}`, 'system'); return; }
  }
  // Identity is the channel AND the pattern: `@say hello` and `@tell hello` are
  // two different rules, and replacing one with the other would be surprising.
  // The group is NOT part of it — regrouping an existing rule should move it, not
  // leave a duplicate behind under the old name.
  const same = (r) => (r.pattern || '').toLowerCase() === pattern.toLowerCase()
    && (r.channel || null) === (channel || null);
  const without = list.filter(r => !same(r));
  without.push({ id: genId(noun[0]), pattern, regex, channel, group, lines, once, cmds, enabled: true });
  save(without);
  const shown = describe({ pattern, regex, channel, group, lines, once, cmds }).trim();
  appendMsg(`${noun} set:\n  ${shown}`, 'system');
}

export function runTriggerCommand(rest) {
  listOrManage(rest, {
    load: loadTriggers, save: saveTriggers, noun: 'trigger',
    extra: "Try:  trigger you're bleeding = bandage   ·   trigger #combat once /(\w+) hits you/ = flee",
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
  // `after` makes it a one-shot: `timer after 30s = look`. Half of what people
  // want a timer for is "do this once, in a minute" — a repeating timer used that
  // way has to be remembered and turned off, and it never is.
  const once = /^after\b/i.test(arg);
  const body = once ? arg.replace(/^after\s*/i, '') : arg;
  const m = body.match(/^(\d+)\s*(ms|s|m)?\s*=\s*(.+)$/i);
  if (!m) {
    appendMsg('Usage: timer <interval> = <commands>       repeating, e.g.  timer 30s = look\n'
      + '       timer after <interval> = <commands>  once, e.g.  timer after 90s = say I have to go\n'
      + '       timer off   ·   timer clear', 'system');
    return;
  }
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const everyMs = unit === 'ms' ? n : unit === 'm' ? n * 60000 : n * 1000;
  if (everyMs < MIN_INTERVAL_MS) {
    appendMsg(`The shortest timer is ${MIN_INTERVAL_MS / 1000}s — anything faster is a command every `
      + `tick, forever, which isn't something you want running by accident.`, 'system');
    return;
  }
  list.push({ id: genId('t'), label: `${n}${unit}`, everyMs, once, cmds: m[3].trim(), enabled: true });
  saveTimers(list);
  appendMsg(once
    ? `Timer set: once, in ${Math.round(everyMs / 1000)}s → ${m[3].trim()}.`
    : `Timer set: every ${Math.round(everyMs / 1000)}s → ${m[3].trim()}. "timer off" stops the lot.`,
    'system');
}
