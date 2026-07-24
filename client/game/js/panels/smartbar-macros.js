// Player-defined "macro" buttons for the smartbar. A macro is a saved command
// (or a semicolon-separated sequence) bound to a labelled button that sits
// between the Tablet/Inv anchors and the room's context verbs. Purely
// client-side, per-browser — same localStorage-preference model as
// custom/store.js. Nothing here touches the server beyond firing real commands.
//
// Chaining: `cmds` is a raw string; segments split on newline or ";". Commands
// fire with a small default stagger so movement chains resolve room-by-room; an
// explicit `delay <ms>` pseudo-command inserts a custom pause, e.g.
//   north;delay 1000;get all;south
//
// Conditionals: single-line `if / elseif / else / endif` gate which commands run.
// Loops: `while <cond> … endwhile` repeat the body while the condition holds,
// re-tested at the top of each pass; every pass costs one step against the global
// MAX_STEPS budget so a runaway loop always terminates. A pass that ran no `delay`
// of its own is auto-paused (MIN_LOOP_INTERVAL_MS) before looping back, so an
// unpaced body can't trickle-spam the server or spin the tab.
// A condition is one of:
//   <value> <op> <number>   — op ∈ < <= > >= == != ; value from VARS (live vitals)
//   has <item>              — true if the item is in your inventory
//   lacks <item>            — the negation
//   in <zone>               — true when in that zone (matches the zone id OR name)
//   notin <zone>            — the negation
//   in home / notin home    — true when at (or away from) your bound home zone
// $zone / $zone_id also interpolate the current room name / id into text, and
// $home / $home_id the bound home's friendly label / raw zone id.
// (a macro that reads inventory silently refreshes it first, so has/lacks are
//  reliable even if the player never opened their Gear)
// Values may be written bare (hp_pct) or $-prefixed ($hp_pct), and $values also
// interpolate into commands/echo text, e.g.  echo I have $credits credits.
// `echo <text>` prints locally (never sent to the server). Blocks may nest.
// validateMacro() checks the structure for the editor's Test button; the Guide
// window surfaces the client-known values / furniture / item actions / commands.
import { sendCmd } from '../net.js';
import { appendMsg, appendHtml } from '../render.js';
import { state } from '../state.js';
import { getTabletInventory } from './tablet-os.js';
import { refreshInventory, getEquipInventory } from './inventory-state.js';
import { handleClientCommand } from '../input.js';
import { renderSmartBar } from './smartbar.js';

const KEY = 'architect_smartbar_macros';
const DEFAULT_STAGGER_MS = 350;
const DEFAULT_COLOR = '#2ee6ff';   // matches the .smart-btn-macro CSS default

// The stock button colours — the macro default plus the theme accents used by the
// Tablet/Smart command buttons — offered as quick-picks alongside colours the
// player has already used. Resolved from the live theme so they track the theme.
function stockSwatchColors() {
  const cs = getComputedStyle(document.documentElement);
  const out = [DEFAULT_COLOR];
  for (const v of ['--accent', '--accent-dim']) {
    const c = cs.getPropertyValue(v).trim();
    if (c) out.push(c);
  }
  return out.map((c) => c.toLowerCase());
}

// ── Store ─────────────────────────────────────────────────────────────────────
// Shape: [{ id, label, cmds, color }] — cmds is the raw ";"-separated string,
// color is a hex string or null (= use the .smart-btn-macro CSS default).
export function loadMacros() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function saveMacros(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

function genId() {
  return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function addMacro(macro) {
  const list = loadMacros();
  list.push(macro);
  saveMacros(list);
  return macro;
}

function updateMacro(id, patch) {
  const list = loadMacros();
  const m = list.find((x) => x.id === id);
  if (!m) return null;
  Object.assign(m, patch);
  saveMacros(list);
  return m;
}

function removeMacro(id) {
  saveMacros(loadMacros().filter((x) => x.id !== id));
}

// ── Conditions ──────────────────────────────────────────────────────────────
// Variables an `if` may read, resolved from the live player vitals in state.js.
const pct = (v, max) => (max ? (Number(v) || 0) / Number(max) * 100 : 0);
const VARS = {
  hp: (p) => p.hp,
  hp_max: (p) => p.hp_max ?? 100,
  hp_pct: (p) => pct(p.hp, p.hp_max ?? 100),
  stamina: (p) => p.stamina,
  sta: (p) => p.stamina,
  stamina_pct: (p) => pct(p.stamina, p.stamina_max ?? 100),
  sanity: (p) => p.sanity,
  sanity_pct: (p) => pct(p.sanity, p.sanity_max ?? 100),
  hunger: (p) => p.hunger,
  thirst: (p) => p.thirst,
  radiation: (p) => p.radiation ?? 0,
  rad: (p) => p.radiation ?? 0,
  credits: (p) => p.credits ?? 0,
  horniness: (p) => p.horniness ?? 0,
  body_temp: (p) => p.body_temp_c,
};
const OPS = {
  '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '==': (a, b) => a === b, '=': (a, b) => a === b,
  '!=': (a, b) => a !== b, '<>': (a, b) => a !== b,
};
// Short descriptions for the Guide "Values" tab.
const VALUE_DESC = {
  hp: 'current hit points', hp_max: 'max hit points', hp_pct: 'HP as % of max',
  stamina: 'current stamina', sta: 'current stamina (alias)', stamina_pct: 'stamina as % of max',
  sanity: 'current sanity', sanity_pct: 'sanity as % of max',
  hunger: 'hunger level (0–100)', thirst: 'thirst level (0–100)',
  radiation: 'radiation (0–100)', rad: 'radiation (alias)',
  credits: 'credits on hand', horniness: 'arousal (0–100, MIS)', body_temp: 'body temperature °C',
};
// Client-side quick reference of common player verbs for the Guide "Commands"
// tab (the full authoritative list lives server-side — `help` in-game). Admin
// verbs aren't held on the client, so admins are pointed at the @admin panel.
const COMMAND_REF = [
  { cat: 'Movement', cmds: [
    { v: 'north', d: 'move (also s/e/w/ne/nw/se/sw, up, down)' },
    { v: 'go <dir>', d: 'move a direction' }, { v: 'enter <thing>', d: 'enter a door/vehicle' },
    { v: 'gps <name>', d: 'plot a route to a location' },
    { v: 'auto', d: 'toggle walking the plotted GPS route' },
    { v: 'auto on', d: 'start auto-walk (deterministic — best in macros)' },
    { v: 'auto off', d: 'stop auto-walk' },
    { v: 'home', d: 'walk to your bound home (or bind it in an apartment you own)' } ] },
  { cat: 'Observe', cmds: [
    { v: 'look', d: 'look at the room' }, { v: 'examine <thing>', d: 'inspect a target' },
    { v: 'search', d: 'scavenge the area' } ] },
  { cat: 'Items', cmds: [
    { v: 'inventory', d: 'list what you carry' }, { v: 'get <item>', d: 'pick up' },
    { v: 'drop <item>', d: 'put down' }, { v: 'equip <item>', d: 'wear/wield' },
    { v: 'unequip <item>', d: 'remove' }, { v: 'use <item>', d: 'use/apply' },
    { v: 'eat <item>', d: 'eat' }, { v: 'drink <item>', d: 'drink' } ] },
  { cat: 'Combat', cmds: [
    { v: 'attack <target>', d: 'engage' }, { v: 'flee', d: 'run from combat' },
    { v: 'fight <stance>', d: 'berserk/aggressive/normal/cautious/pacifist' },
    { v: 'pow', d: 'power attack — slow, 250% damage' },
    { v: 'dodge', d: 'give ground: +5 defense, no attacking' },
    { v: 'loot <corpse>', d: 'loot the dead' } ] },
  { cat: 'Social', cmds: [
    { v: 'say <text>', d: 'speak aloud' }, { v: 'talk <npc>', d: 'start dialogue' },
    { v: 'whisper <who> <text>', d: 'private message' }, { v: 'emote <action>', d: 'act it out' } ] },
  { cat: 'Posture', cmds: [
    { v: 'sit', d: 'sit down' }, { v: 'lie', d: 'lie down' }, { v: 'stand', d: 'stand up' },
    { v: 'rest', d: 'recover while seated/lying' } ] },
  { cat: 'Macro-only', cmds: [
    { v: 'delay <ms>', d: 'pause the macro' }, { v: 'echo <text>', d: 'print locally (not sent)' },
    { v: 'if <cond>', d: 'branch (… elseif / else / endif)' },
    { v: 'while <cond>', d: 'repeat lines until … endwhile (condition goes false)' },
    { v: 'in <zone>', d: 'condition: in this zone (by id or name)' },
    { v: 'macro <name>', d: 'run another saved macro' } ] },
];

// value ± $-prefix, then a comparison operator and a number.
const CMP_RE = /^\$?(\w+)\s*(<=|>=|==|!=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?)$/;
const HAS_RE = /^(has|lacks)\s+(.+)$/i;
const IN_RE = /^(in|notin|!in)\s+(.+)$/i;

// Current room's display name (lowercased), from the live look header.
function zoneName() {
  return String(document.getElementById('zone-name-display')?.textContent || '').trim();
}

// A friendly label for the player's bound home. The client only holds the home
// zone *id* (state.player.home_zone), never its display name, so derive a readable
// string the same way the chat markup $home token does. '' when no home is set.
function homeName() {
  const hz = state.player?.home_zone;
  return hz ? String(hz).replace(/^zone_/, '').replace(/_/g, ' ') : '';
}

// Parse a condition into a structured form, or null if malformed / unknown.
function parseCond(text) {
  const t = String(text).trim();
  let m = t.match(HAS_RE);
  if (m) return { type: 'has', token: m[2].trim().toLowerCase(), negate: /^lacks$/i.test(m[1]) };
  m = t.match(IN_RE);
  if (m) {
    const token = m[2].trim().toLowerCase();
    const negate = /^(notin|!in)$/i.test(m[1]);
    // `in home` / `notin home` is a dedicated test against the bound home zone id,
    // not a name/id substring match like every other `in <zone>`.
    if (token === 'home') return { type: 'home', negate };
    return { type: 'zone', token, negate };
  }
  m = t.match(CMP_RE);
  if (!m) return null;
  const varFn = VARS[m[1].toLowerCase()];
  if (!varFn || !OPS[m[2]]) return null;
  return { type: 'cmp', varFn, op: m[2], rhs: Number(m[3]) };
}

// Freshest inventory the client holds: the silently-refreshed equip snapshot if
// present, else the tablet's last gear payload.
function currentInventory() {
  const equip = getEquipInventory();
  return (equip && equip.length) ? equip : getTabletInventory();
}

// True if the current inventory holds an item matching `token` — by item TYPE id
// (item_id, e.g. "item_field_bandage") or a substring of the display name. It's a
// "do I have any of this item" check, so it never keys on the per-stack instance id.
function inventoryHas(token) {
  return currentInventory().some((it) =>
    String(it.item_id || '').toLowerCase() === token || String(it.name || '').toLowerCase().includes(token));
}

// Does this macro read inventory (a `has`/`lacks` condition anywhere)?
function usesInventory(segs) {
  return segs.some((s) => {
    const c = classify(s);
    return (c.kind === 'if' || c.kind === 'elseif') && parseCond(c.cond)?.type === 'has';
  });
}

function evalCond(cond) {
  if (cond.type === 'has') {
    const hit = inventoryHas(cond.token);
    return cond.negate ? !hit : hit;
  }
  if (cond.type === 'zone') {
    // Match the token against BOTH the zone id and the room's display name.
    const id = String(state.currentZone || '').toLowerCase();
    const name = zoneName().toLowerCase();
    const hit = cond.token === id || (!!name && name.includes(cond.token));
    return cond.negate ? !hit : hit;
  }
  if (cond.type === 'home') {
    // True only when the current zone is the player's bound home (compared by id).
    const home = String(state.player?.home_zone || '').toLowerCase();
    const hit = !!home && String(state.currentZone || '').toLowerCase() === home;
    return cond.negate ? !hit : hit;
  }
  const p = state.player;
  if (!p) return false;
  const left = cond.varFn(p);
  if (left === undefined || left === null || Number.isNaN(Number(left))) return false;
  return OPS[cond.op](Number(left), cond.rhs);
}

// Replace $value tokens in command/echo text with the current live value. Numeric
// vitals round to an integer; $zone / $zone_id resolve the current room name / id;
// $home / $home_id resolve the bound home's friendly label / raw zone id.
function interpolate(text) {
  const p = state.player || {};
  return String(text).replace(/\$([a-z_]+)/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (key === 'zone') return zoneName() || whole;
    if (key === 'zone_id') return String(state.currentZone || '') || whole;
    if (key === 'home') return homeName() || whole;              // friendly home label
    if (key === 'home_id') return String(p.home_zone || '') || whole; // raw home zone id
    const fn = VARS[key];
    if (!fn) return whole;
    const v = fn(p);
    return (v === undefined || v === null || Number.isNaN(Number(v))) ? whole : String(Math.round(Number(v)));
  });
}

// Classify one segment: control keyword or a plain command.
function classify(seg) {
  const lower = seg.toLowerCase();
  if (lower === 'endif') return { kind: 'endif' };
  if (lower === 'else') return { kind: 'else' };
  if (lower === 'endwhile') return { kind: 'endwhile' };
  let m = seg.match(/^if\s+(.+)$/i);
  if (m) return { kind: 'if', cond: m[1].trim() };
  m = seg.match(/^elseif\s+(.+)$/i);
  if (m) return { kind: 'elseif', cond: m[1].trim() };
  m = seg.match(/^while\s+(.+)$/i);
  if (m) return { kind: 'while', cond: m[1].trim() };
  return { kind: 'cmd', text: seg };
}

// Index of the `endwhile` that closes the `while` at `from` (depth-matched, so
// nested loops are skipped correctly). Returns segs.length if unclosed — the
// validator forbids that, so it's only a safety fallback.
function matchEndwhile(segs, from) {
  let depth = 0;
  for (let j = from; j < segs.length; j++) {
    const k = classify(segs[j]).kind;
    if (k === 'while') depth++;
    else if (k === 'endwhile' && --depth === 0) return j;
  }
  return segs.length;
}

// ── Auto-correct (the editor's Check button) ──────────────────────────────────
// Applies safe, mechanical fixes and returns { text, fixes:[…] }:
//   • normalise to one segment per line (split ";"/newlines, trim, drop blanks)
//   • "else if"/"elif" → "elseif"; lowercase leading keywords (IF → if)
//   • operator typos in conditions ( =<  → <= ,  =>  → >= )
//   • append a missing "endif" for each unclosed "if"
//   • re-indent nested if/elseif/else/endif blocks (2 spaces per level) so the
//     structure reads as a tree. Indentation is cosmetic — the validator and the
//     runner trim every segment — so it round-trips (Check & Fix is idempotent).
// It never removes commands or guesses intent beyond these.
const KW_RE = /^(if|elseif|else|endif|while|endwhile|echo|delay)\b/i;
export function autoFix(cmds) {
  const fixes = [];
  let lines = String(cmds || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  lines = lines.map((line) => {
    let l = line.replace(/^else\s+if\b/i, 'elseif').replace(/^elif\b/i, 'elseif');
    l = l.replace(KW_RE, (m) => m.toLowerCase());
    if (/^(if|elseif|while)\b/.test(l)) l = l.replace(/=</g, '<=').replace(/=>/g, '>=');
    if (l !== line) fixes.push(`"${line}" → "${l}"`);
    return l;
  });
  // Append a matching closer for each still-open block, innermost first, so a
  // dangling `if`/`while` gets its own `endif`/`endwhile`.
  const open = [];
  for (const l of lines) {
    const k = l.toLowerCase();
    if (/^if\b/.test(k)) open.push('endif');
    else if (/^while\b/.test(k)) open.push('endwhile');
    else if ((k === 'endif' || k === 'endwhile') && open[open.length - 1] === k) open.pop();
  }
  while (open.length) { const closer = open.pop(); lines.push(closer); fixes.push(`added missing "${closer}"`); }
  // Re-indent so the block structure reads as a tree. `if`/`while` open a level
  // (their body indents one deeper); `elseif`/`else` sit at the parent's level;
  // `endif`/`endwhile` close.
  let ind = 0;
  lines = lines.map((line) => {
    const k = line.toLowerCase();
    if (k === 'endif' || k === 'endwhile') ind = Math.max(0, ind - 1);
    const col = /^(elseif|else)\b/.test(k) ? Math.max(0, ind - 1) : ind;
    if (/^if\b/.test(k) || /^while\b/.test(k)) ind++;
    return '  '.repeat(col) + line;
  });
  return { text: lines.join('\n'), fixes };
}

// ── Static validation (drives the editor's Check button) ──────────────────────
// Returns { ok:true } or { ok:false, error, line } (1-based segment index).
export function validateMacro(cmds) {
  const segs = String(cmds || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { ok: false, error: 'Empty — add at least one command.', line: 0 };
  const stack = []; // frames: { kind:'if'|'while', seenElse }
  const top = () => stack[stack.length - 1];
  let ran = 0;
  for (let i = 0; i < segs.length; i++) {
    const c = classify(segs[i]);
    const ln = i + 1;
    if (c.kind === 'if') {
      if (!parseCond(c.cond)) return { ok: false, error: `Bad condition: "${c.cond}"`, line: ln };
      stack.push({ kind: 'if', seenElse: false });
    } else if (c.kind === 'while') {
      if (!parseCond(c.cond)) return { ok: false, error: `Bad condition: "${c.cond}"`, line: ln };
      stack.push({ kind: 'while' });
    } else if (c.kind === 'elseif') {
      if (top()?.kind !== 'if') return { ok: false, error: '"elseif" without an open "if".', line: ln };
      if (top().seenElse) return { ok: false, error: '"elseif" after "else".', line: ln };
      if (!parseCond(c.cond)) return { ok: false, error: `Bad condition: "${c.cond}"`, line: ln };
    } else if (c.kind === 'else') {
      if (top()?.kind !== 'if') return { ok: false, error: '"else" without an open "if".', line: ln };
      if (top().seenElse) return { ok: false, error: 'Duplicate "else".', line: ln };
      top().seenElse = true;
    } else if (c.kind === 'endif') {
      if (top()?.kind !== 'if') return { ok: false, error: '"endif" without an open "if".', line: ln };
      stack.pop();
    } else if (c.kind === 'endwhile') {
      if (top()?.kind !== 'while') return { ok: false, error: '"endwhile" without an open "while".', line: ln };
      stack.pop();
    } else {
      ran++; // a command (or delay) — always structurally valid
    }
  }
  if (stack.length) {
    const closer = top().kind === 'while' ? 'endwhile' : 'endif';
    return { ok: false, error: `${stack.length} block(s) not closed (expected "${closer}").`, line: segs.length };
  }
  if (!ran) return { ok: false, error: 'No commands to run.', line: 0 };
  return { ok: true };
}

// ── Lint (non-blocking advisories) ────────────────────────────────────────────
// Structural problems are caught by validateMacro and block Save. Lint is the
// softer tier: things that run fine but are worth telling the author about, so
// the runtime guard isn't the first time they learn the behaviour. Returns a
// list of human-readable warnings (empty when the macro is clean). Assumes the
// macro already passed validateMacro (balanced blocks).
export function lintMacro(cmds) {
  const segs = String(cmds || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const warnings = [];
  // A `while` whose body runs no `delay` of its own is auto-paced to ~1/sec by
  // the runtime guard. Nudge the author to set their own cadence instead.
  const loopStart = []; // indices of open `while` segments
  for (let i = 0; i < segs.length; i++) {
    const c = classify(segs[i]);
    if (c.kind === 'while') loopStart.push({ line: i + 1, sawDelay: false });
    else if (c.kind === 'endwhile') {
      const f = loopStart.pop();
      if (f && !f.sawDelay) warnings.push(`Line ${f.line}: this "while" has no "delay" — it'll be auto-paced to ~1/sec. Add a "delay" to set your own speed.`);
    } else if (/^delay\s+\d+$/i.test(segs[i])) {
      for (const f of loopStart) f.sawDelay = true; // a delay paces every open loop
    }
  }
  return warnings;
}

// ── Chain runner ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mark every open `while` frame as having paused this pass. Called after any real
// wait (an explicit `delay` or the implicit loop guard) so an enclosing loop
// counts a nested pause as its own pacing and doesn't stack another one.
function markLoopsPaced(stack) {
  for (const f of stack) if (f.kind === 'while') f.sawDelay = true;
}

// Minimal HTML escape for the user-set label going into an innerHTML banner.
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A "*** <label> started…/finished" banner, tinted in the macro's own button
// colour, printed only for a top-level run (nested `macro <name>` calls stay quiet).
function macroBanner(label, phase, color) {
  appendHtml(`<span style="color:${color || DEFAULT_COLOR}">*** ${escHtml(label)} ${phase}</span>`, 'macro-banner');
}

// Whether the current (possibly nested) branch is executing.
function branchActive(stack) {
  return stack.length ? stack[stack.length - 1].active : true;
}

// Loop/runaway guards for macros that call other macros.
const MAX_DEPTH = 20;   // deepest macro-calls-macro nesting
const MAX_STEPS = 1000; // total executed actions across one whole run
// A `while` pass whose body ran no `delay` of its own is forced to pause this
// long before looping back, so a body that forgot to pace itself can't
// trickle-spam the server (and an empty-body loop can't busy-spin).
const MIN_LOOP_INTERVAL_MS = 1000;

// Find a macro by label (case-insensitive, trimmed).
function findMacroByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return loadMacros().find((m) => (m.label || '').trim().toLowerCase() === key) || null;
}

// Live top-level runs, tracked so (a) the smartbar can show a Stop chip while any
// macro is running, and (b) an external signal — the server rejecting commands
// for exceeding its rate limit, or the player's `stop`/Stop chip — can halt them
// mid-flight. Registering/unregistering re-renders the bar so the chip appears
// and disappears with the run.
const activeRuns = new Set();
function beginRun(shared) { activeRuns.add(shared); renderSmartBar(); }
function endRun(shared) { activeRuns.delete(shared); renderSmartBar(); }

// True while at least one top-level macro run is in flight (drives the Stop chip).
export function isMacroRunning() { return activeRuns.size > 0; }

// Abort every running macro. Returns true if any were running. Called from the
// dispatch `error` handler when the server kicks back a rate-limit error, and
// from the `stop` verb / smartbar Stop chip, so a loop stops instead of grinding
// on. A run parked in a long `delay` only unwinds once that sleep resolves (the
// abort flag is checked at the top of each segment).
export function abortMacros() {
  let any = false;
  for (const shared of activeRuns) { shared.aborted = true; any = true; }
  return any;
}

// Entry point for typing `macro <name>` (input.js) or the smartbar button.
export function runMacroByName(name) {
  const macro = findMacroByName(name);
  if (!macro) { appendMsg(`No macro named "${String(name).trim()}".`, 'system'); return Promise.resolve(); }
  const shared = { steps: 0, invRefreshed: false, aborted: false };
  beginRun(shared);
  return runMacro(macro.cmds, { depth: 0, stack: [macro.id], label: macro.label, color: macro.color, shared })
    .finally(() => endRun(shared));
}

// Run one macro's command string. `ctx` carries recursion/loop state; omit it for
// a fresh top-level run.
export async function runMacro(cmds, ctx) {
  ctx = ctx || { depth: 0, stack: [], shared: { steps: 0, invRefreshed: false, aborted: false } };
  // Start/finish banner: only for the top-level run that carries a label.
  const topLevel = ctx.depth === 0 && !!ctx.label;
  if (topLevel) macroBanner(ctx.label, 'started…', ctx.color);
  const segs = String(cmds || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  // If the macro branches on inventory, silently pull a fresh copy first (once
  // per run) so `has`/`lacks` reflect reality even if Gear was never opened.
  if (!ctx.shared.invRefreshed && usesInventory(segs)) { ctx.shared.invRefreshed = true; await refreshInventory(); }
  // Control-flow frames, pushed by if/while. if: { kind:'if', parentActive,
  // taken, active }. while: { kind:'while', parentActive, active, startIdx }.
  // branchActive() reads the top frame's `active` for both kinds.
  const stack = [];
  let ranAny = false, lastWasDelay = false;

  for (let i = 0; i < segs.length; i++) {
    if (ctx.shared.aborted) break;
    const seg = segs[i];
    const c = classify(seg);
    if (c.kind === 'if') {
      const parentActive = branchActive(stack);
      const cond = parseCond(c.cond);
      const matched = parentActive && !!cond && evalCond(cond);
      stack.push({ kind: 'if', parentActive, taken: matched, active: matched });
    } else if (c.kind === 'elseif') {
      const f = stack[stack.length - 1];
      if (!f) continue;
      const cond = parseCond(c.cond);
      const matched = f.parentActive && !f.taken && !!cond && evalCond(cond);
      f.active = matched;
      f.taken = f.taken || matched;
    } else if (c.kind === 'else') {
      const f = stack[stack.length - 1];
      if (!f) continue;
      f.active = f.parentActive && !f.taken;
      f.taken = true;
    } else if (c.kind === 'endif') {
      stack.pop();
    } else if (c.kind === 'while') {
      // Re-evaluate the condition each pass. When false (or the enclosing branch
      // is dead) skip the whole body; when true, enter it and charge one step
      // against the global budget so a runaway loop always terminates.
      const parentActive = branchActive(stack);
      const cond = parseCond(c.cond);
      const on = parentActive && !!cond && evalCond(cond);
      if (!on) { i = matchEndwhile(segs, i); continue; }
      if (++ctx.shared.steps > MAX_STEPS) {
        ctx.shared.aborted = true;
        appendMsg('Macro stopped — too many steps (possible loop).', 'system');
        break;
      }
      stack.push({ kind: 'while', parentActive, active: true, startIdx: i, sawDelay: false });
    } else if (c.kind === 'endwhile') {
      const f = stack.pop();               // the matching while frame
      if (f && f.kind === 'while') {
        // Guard: a pass that never paused on its own gets an automatic pause, so
        // an unpaced loop can't hammer the server (or spin the tab) each cycle.
        if (!f.sawDelay) { await sleep(MIN_LOOP_INTERVAL_MS); markLoopsPaced(stack); }
        i = f.startIdx - 1;                // jump back to re-test the condition
      }
    } else {
      if (!branchActive(stack)) continue;      // skip commands in a dead branch
      // Global step budget guards against runaway expansion / loops.
      if (++ctx.shared.steps > MAX_STEPS) {
        ctx.shared.aborted = true;
        appendMsg('Macro stopped — too many steps (possible loop).', 'system');
        break;
      }
      const d = seg.match(/^delay\s+(\d+)$/i);
      if (d) { await sleep(Number(d[1])); markLoopsPaced(stack); ranAny = true; lastWasDelay = true; continue; }
      const e = seg.match(/^echo\s+(.*)$/i);
      if (e) { appendMsg(interpolate(e[1]), 'system'); ranAny = true; lastWasDelay = false; continue; }
      const mm = seg.match(/^macro\s+(.+)$/i);
      if (mm) { await runNestedMacro(mm[1].trim(), ctx); ranAny = true; lastWasDelay = false; continue; }
      if (ranAny && !lastWasDelay) await sleep(DEFAULT_STAGGER_MS);
      const line = interpolate(seg);
      // Route client-only verbs (auto, stop, music, …) through the same handler the
      // command box uses, so they don't fall through to the server as "unknown".
      if (!handleClientCommand(line, { notify: (t) => appendMsg(t, 'system') })) sendCmd(line);
      ranAny = true; lastWasDelay = false;
    }
  }
  if (topLevel) macroBanner(ctx.label, ctx.shared.aborted ? 'stopped' : 'finished', ctx.color);
}

// Run a macro invoked from inside another macro, with cycle + depth guards.
async function runNestedMacro(name, ctx) {
  if (ctx.shared.aborted) return;
  const macro = findMacroByName(name);
  if (!macro) { appendMsg(`Macro "${name}" not found.`, 'system'); return; }
  if (ctx.stack.includes(macro.id)) {
    ctx.shared.aborted = true;
    appendMsg(`Macro loop blocked: "${macro.label}" calls itself.`, 'system');
    return;
  }
  if (ctx.depth >= MAX_DEPTH) {
    ctx.shared.aborted = true;
    appendMsg('Macro nesting too deep — stopped.', 'system');
    return;
  }
  await runMacro(macro.cmds, { depth: ctx.depth + 1, stack: [...ctx.stack, macro.id], shared: ctx.shared });
}

// ── Node builder (consumed by renderSmartBar) ───────────────────────────────
// A macro renders as a leaf node whose onFire runs the chain — routes straight
// through the existing runNode onFire branch in smartbar.js.
export function buildMacroNodes() {
  return loadMacros().map((m) => ({
    label: m.label,
    color: m.color || null,
    macro: true,
    macroId: m.id,
    onFire: () => {
      const shared = { steps: 0, invRefreshed: false, aborted: false };
      beginRun(shared);
      return runMacro(m.cmds, { depth: 0, stack: [m.id], label: m.label, color: m.color, shared })
        .finally(() => endRun(shared));
    },
  }));
}

// ── Guide window ──────────────────────────────────────────────────────────────
// A layered reference over the editor: Values / Furniture / Items / Commands,
// all read from what the client already holds. Clicking an entry inserts it into
// the commands box. Roles that can use admin tools also see an Admin pointer.
const ADMIN_ROLES = ['admin', 'dev', 'builder', 'designer'];
let _guide = null;
let _invRefreshed = false; // guard: refresh the Items tab at most once per open

function closeGuide() { _guide?.remove(); _guide = null; }

// Insert `text` as a new line in the commands box and fire input (re-locks Test).
function insertLine(cmdsInput, text) {
  const cur = cmdsInput.value;
  cmdsInput.value = (cur && !cur.endsWith('\n')) ? `${cur}\n${text}` : `${cur}${text}`;
  cmdsInput.dispatchEvent(new Event('input'));
}

// One clickable reference row: monospace token + dim description.
function guideRow(token, desc, onClick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'smart-guide-row';
  const t = document.createElement('span');
  t.className = 'smart-guide-tok';
  t.textContent = token;
  row.appendChild(t);
  if (desc) {
    const d = document.createElement('span');
    d.className = 'smart-guide-desc';
    d.textContent = desc;
    row.appendChild(d);
  }
  row.addEventListener('click', onClick);
  return row;
}

function guideNote(text) {
  const n = document.createElement('div');
  n.className = 'smart-guide-note';
  n.textContent = text;
  return n;
}

function guideHeading(text) {
  const h = document.createElement('div');
  h.className = 'smart-guide-group';
  h.textContent = text;
  return h;
}

function guidePara(text) {
  const p = document.createElement('div');
  p.className = 'smart-guide-para';
  p.textContent = text;
  return p;
}

// A monospace example block; each line shown verbatim.
function guideExample(lines) {
  const pre = document.createElement('pre');
  pre.className = 'smart-guide-ex';
  pre.textContent = lines.join('\n');
  return pre;
}

// The Overview page: a plain-language tour of every macro feature.
function renderOverview(content) {
  content.appendChild(guidePara(
    'A macro is a button that fires one or more commands for you. Type commands one per line ' +
    '(or separated by ";"). They run top to bottom, with a short pause between each so movement resolves.'));

  content.appendChild(guideHeading('delay'));
  content.appendChild(guidePara('Pause the macro for a number of milliseconds.'));
  content.appendChild(guideExample(['north', 'delay 1000', 'open door']));

  content.appendChild(guideHeading('echo'));
  content.appendChild(guidePara('Print a line only you see — never sent to the world. Good for reminders and status.'));
  content.appendChild(guideExample(['echo Patching myself up…']));

  content.appendChild(guideHeading('$values'));
  content.appendChild(guidePara(
    'Live player numbers like $hp, $hp_pct, $stamina, $credits. Drop them into text, or compare them ' +
    'in a condition. See the Values tab for the full list and current readings.'));
  content.appendChild(guideExample(['echo HP $hp / stamina $stamina']));

  content.appendChild(guideHeading('if / elseif / else / endif'));
  content.appendChild(guidePara(
    'Run lines only when a condition holds. A condition is a value compared to a number ' +
    '(operators < <= > >= == !=), "has <item>" / "lacks <item>", "in <zone>" / "notin <zone>" ' +
    '(which match the current zone by its id OR its name), or "in home" / "notin home" ' +
    '(your bound home). Every "if" ends with "endif"; blocks may nest.'));
  content.appendChild(guideExample([
    'if has item_field_bandage',
    'use item_field_bandage',
    'else',
    'echo You have no field bandages!',
    'endif']));
  content.appendChild(guideExample([
    'if $hp_pct < 50',
    'echo Low HP — falling back',
    'elseif $stamina < 20',
    'rest',
    'endif']));

  content.appendChild(guideHeading('while / endwhile'));
  content.appendChild(guidePara(
    'Repeat the lines between "while <cond>" and "endwhile" as long as the condition holds — the ' +
    'condition is re-checked at the top of every pass. Same conditions as "if". Put a "delay" in the ' +
    'body so it paces itself. A loop that never ends is capped and stopped automatically.'));
  content.appendChild(guideExample([
    'while notin clone facility',
    'auto',
    'delay 1500',
    'endwhile',
    'drink sink']));

  content.appendChild(guideHeading('Run macros anywhere'));
  content.appendChild(guidePara(
    'Type "macro <name>" in the command box to run a saved macro by its label — and a macro can run ' +
    'another macro the same way. Loops (a macro that ends up calling itself) are detected and stopped.'));
  content.appendChild(guideExample(['macro Heal Up', 'delay 500', 'macro Buff']));

  content.appendChild(guideHeading('Stopping a macro'));
  content.appendChild(guidePara(
    'While a macro is running, a red "■ Stop" chip appears at the left of the smartbar — tap it to halt ' +
    'everything. Typing "stop" does the same (it also cancels auto-walk). A macro parked in a long "delay" ' +
    'finishes that pause before it stops.'));

  content.appendChild(guideHeading('Check & Fix'));
  content.appendChild(guidePara(
    'The Check & Fix button validates your macro and tidies it up — one command per line, ' +
    'keyword case, a missing "endif", and indented nested if/else blocks so the structure reads ' +
    'as a tree. It tidies existing macros the moment you open them, too. A macro must pass before ' +
    'it can be added.'));
}

function renderGuideTab(name, content, cmdsInput) {
  content.textContent = '';
  if (name === 'Overview') {
    renderOverview(content);
  } else if (name === 'Values') {
    content.appendChild(guideNote('Live player values. Use in conditions (if $hp_pct < 50) or inside text (echo I have $credits).'));
    const p = state.player || {};
    for (const key of Object.keys(VALUE_DESC)) {
      const raw = VARS[key](p);
      const live = (raw === undefined || raw === null || Number.isNaN(Number(raw))) ? '—' : String(Math.round(Number(raw)));
      content.appendChild(guideRow(`$${key}`, `${VALUE_DESC[key]}  ·  now: ${live}`, () => insertLine(cmdsInput, `$${key}`)));
    }
    // Current zone — text values, plus the "in / notin" test that matches name OR id.
    content.appendChild(guideRow('$zone', `room name  ·  now: ${zoneName() || '—'}`, () => insertLine(cmdsInput, '$zone')));
    content.appendChild(guideRow('$zone_id', `zone id  ·  now: ${state.currentZone || '—'}`, () => insertLine(cmdsInput, '$zone_id')));
    content.appendChild(guideRow('in <zone>', 'condition · true here (matches name or id)', () => insertLine(cmdsInput, `in ${state.currentZone || ''}`)));
    content.appendChild(guideRow('notin <zone>', 'condition · true elsewhere', () => insertLine(cmdsInput, 'notin ')));
    // Bound home — the friendly label, the raw id, and the "am I home?" test.
    content.appendChild(guideRow('$home', `home name  ·  now: ${homeName() || '—'}`, () => insertLine(cmdsInput, '$home')));
    content.appendChild(guideRow('$home_id', `home zone id  ·  now: ${state.player?.home_zone || '—'}`, () => insertLine(cmdsInput, '$home_id')));
    content.appendChild(guideRow('in home', 'condition · true when at your bound home', () => insertLine(cmdsInput, 'in home')));
  } else if (name === 'Furniture') {
    content.appendChild(guideNote('Actions on furniture in your current room (updates as you move).'));
    const area = document.getElementById('area-content');
    const links = area ? area.querySelectorAll('span.action-link.furniture-link[data-action]') : [];
    let any = false;
    for (const el of links) {
      const target = (el.dataset.target || '').toLowerCase();
      const label = el.dataset.label || el.textContent.trim();
      const verbs = (el.dataset.actions || '').split(/\s+/).filter(Boolean);
      for (const v of verbs) {
        any = true;
        content.appendChild(guideRow(`${v} ${target}`, label, () => insertLine(cmdsInput, `${v} ${target}`)));
      }
    }
    if (!any) content.appendChild(guideNote('No interactable furniture in this room right now.'));
  } else if (name === 'Items') {
    content.appendChild(guideNote('Your inventory (refreshed live). Uses the item id — commands act on the first matching item you carry.'));
    const inv = currentInventory();
    if (!inv.length && !_invRefreshed) {
      _invRefreshed = true;
      content.appendChild(guideNote('Loading inventory…'));
      refreshInventory().then(() => { if (_guide) renderGuideTab('Items', content, cmdsInput); });
    } else if (!inv.length) {
      content.appendChild(guideNote('You aren\'t carrying anything.'));
    }
    for (const it of inv) {
      const typeId = String(it.item_id || '');           // item TYPE id, not the per-stack instance id
      content.appendChild(guideRow(`has ${typeId}`, `condition · ${it.name}`, () => insertLine(cmdsInput, `has ${typeId}`)));
      for (const v of (it.actions || [])) {
        content.appendChild(guideRow(`${v} ${typeId}`, it.name, () => insertLine(cmdsInput, `${v} ${typeId}`)));
      }
    }
  } else if (name === 'Commands') {
    content.appendChild(guideNote('Common verbs — type "help" in-game for the full list.'));
    for (const group of COMMAND_REF) {
      const h = document.createElement('div');
      h.className = 'smart-guide-group';
      h.textContent = group.cat;
      content.appendChild(h);
      for (const c of group.cmds) content.appendChild(guideRow(c.v, c.d, () => insertLine(cmdsInput, c.v)));
    }
    if (ADMIN_ROLES.includes(state.myRole)) {
      const h = document.createElement('div');
      h.className = 'smart-guide-group';
      h.textContent = 'Admin';
      content.appendChild(h);
      content.appendChild(guideNote('Admin verbs aren\'t held on the client — open the Admin panel (@admin) for the full, role-filtered list.'));
    }
  }
}

function openGuide(cmdsInput) {
  closeGuide();
  _invRefreshed = false;
  const overlay = document.createElement('div');
  overlay.className = 'smart-guide-overlay';
  const box = document.createElement('div');
  box.className = 'smart-guide-box';

  const head = document.createElement('div');
  head.className = 'smart-macro-head';
  head.innerHTML = '<span>Macro Guide</span>';
  const x = document.createElement('button');
  x.className = 'smart-macro-x';
  x.textContent = '✕';
  x.addEventListener('click', closeGuide);
  head.appendChild(x);
  box.appendChild(head);

  const tabsRow = document.createElement('div');
  tabsRow.className = 'smart-guide-tabs';
  const content = document.createElement('div');
  content.className = 'smart-guide-content';
  const TABS = ['Overview', 'Values', 'Furniture', 'Items', 'Commands'];
  const tabBtns = {};
  const select = (name) => {
    for (const t of TABS) tabBtns[t].classList.toggle('on', t === name);
    renderGuideTab(name, content, cmdsInput);
  };
  for (const name of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'smart-guide-tab';
    b.textContent = name;
    b.addEventListener('click', () => select(name));
    tabBtns[name] = b;
    tabsRow.appendChild(b);
  }
  box.append(tabsRow, content);

  overlay.appendChild(box);
  let downOnOverlay = false;
  overlay.addEventListener('mousedown', (e) => { downOnOverlay = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnOverlay) closeGuide(); });
  document.body.appendChild(overlay);
  _guide = overlay;
  select('Overview');
}

// ── Manager modal ─────────────────────────────────────────────────────────────
let _overlay = null;

function closeManager() {
  _overlay?.remove();
  closeGuide();
  _overlay = null;
}

export function openMacroManager() {
  renderManager(null);
}

// `editing` is a macro object when editing, or null for the create form.
function renderManager(editing) {
  closeManager();

  const overlay = document.createElement('div');
  overlay.className = 'smart-macro-overlay';

  const box = document.createElement('div');
  box.className = 'smart-macro-box';

  const head = document.createElement('div');
  head.className = 'smart-macro-head';
  head.innerHTML = '<span>Macros</span>';
  const x = document.createElement('button');
  x.className = 'smart-macro-x';
  x.textContent = '✕';
  x.addEventListener('click', closeManager);
  head.appendChild(x);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'smart-macro-body';
  box.appendChild(body);

  // Existing macros list (hidden while editing one, to keep focus on the form).
  const macros = loadMacros();
  if (!editing && macros.length) {
    const list = document.createElement('div');
    list.className = 'smart-macro-list';
    for (const m of macros) {
      const row = document.createElement('div');
      row.className = 'smart-macro-row';
      const name = document.createElement('button');
      name.className = 'smart-macro-name';
      name.textContent = m.label || '(unnamed)';
      if (m.color) name.style.setProperty('--macro-color', m.color);
      name.addEventListener('click', () => renderManager(m));
      const del = document.createElement('button');
      del.className = 'smart-macro-del';
      del.textContent = '✕';
      del.addEventListener('click', () => { removeMacro(m.id); renderSmartBar(); renderManager(null); });
      row.append(name, del);
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  // Form (create or edit).
  const form = document.createElement('div');
  form.className = 'smart-macro-form';

  const labelWrap = document.createElement('label');
  labelWrap.className = 'smart-macro-field';
  labelWrap.innerHTML = '<span class="smart-macro-label">Label</span>';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'smart-macro-input';
  labelInput.maxLength = 24;
  labelInput.value = editing ? editing.label : '';
  labelInput.placeholder = 'Home';
  labelWrap.appendChild(labelInput);
  form.appendChild(labelWrap);

  const cmdsWrap = document.createElement('label');
  cmdsWrap.className = 'smart-macro-field';
  cmdsWrap.innerHTML = '<span class="smart-macro-label">Commands</span>';
  const cmdsInput = document.createElement('textarea');
  cmdsInput.className = 'smart-macro-input smart-macro-textarea';
  cmdsInput.rows = 10;
  cmdsInput.value = editing ? editing.cmds : '';
  cmdsInput.placeholder = 'One command per line…';
  cmdsWrap.appendChild(cmdsInput);
  const hint = document.createElement('span');
  hint.className = 'smart-macro-hint';
  hint.innerHTML = 'One command per line. Tap <strong>📖 Guide</strong> for how it all works.';
  cmdsWrap.appendChild(hint);
  form.appendChild(cmdsWrap);

  // Colour wheel — a native colour picker. Every macro carries an explicit hex.
  let chosenColor = (editing && editing.color) || DEFAULT_COLOR;
  const colorWrap = document.createElement('div');
  colorWrap.className = 'smart-macro-field';
  colorWrap.innerHTML = '<span class="smart-macro-label">Colour</span>';
  const colorRow = document.createElement('div');
  colorRow.className = 'smart-macro-colorrow';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'smart-macro-color';
  colorInput.value = chosenColor;
  const swatch = document.createElement('span');
  swatch.className = 'smart-macro-preview';
  swatch.textContent = labelInput.value.trim() || 'Macro';
  swatch.style.setProperty('--macro-color', chosenColor);
  const syncPreview = () => {
    swatch.style.setProperty('--macro-color', chosenColor);
    swatch.textContent = labelInput.value.trim() || 'Macro';
  };
  colorInput.addEventListener('input', () => { chosenColor = colorInput.value; syncPreview(); markUsed(); });
  labelInput.addEventListener('input', syncPreview);
  colorRow.append(colorInput, swatch);
  colorWrap.appendChild(colorRow);

  // Quick-pick: the stock Tablet/Smart accent colours first, then colours the
  // player has already used on other macros.
  const used = [...new Set([...stockSwatchColors(), ...loadMacros().map((x) => (x.color || '').toLowerCase()).filter(Boolean)])];
  let markUsed = () => {};
  if (used.length) {
    const usedRow = document.createElement('div');
    usedRow.className = 'smart-macro-used';
    const chips = used.map((c) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'smart-macro-usedchip';
      chip.style.background = c;
      chip.title = c;
      chip.addEventListener('click', () => {
        chosenColor = c;
        colorInput.value = c;
        syncPreview();
        markUsed();
      });
      usedRow.appendChild(chip);
      return { chip, c };
    });
    markUsed = () => chips.forEach(({ chip, c }) => chip.classList.toggle('on', c === chosenColor.toLowerCase()));
    markUsed();
    colorWrap.appendChild(usedRow);
  }
  form.appendChild(colorWrap);

  body.appendChild(form);

  // Check row — must pass before the macro can be added; any edit invalidates it.
  // Check also applies safe auto-corrections to the commands box.
  const testRow = document.createElement('div');
  testRow.className = 'smart-macro-testrow';
  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'smart-macro-test';
  testBtn.textContent = 'Check & Fix';
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'smart-macro-guide';
  guideBtn.textContent = '📖 Guide';
  guideBtn.addEventListener('click', () => openGuide(cmdsInput));
  const testMsg = document.createElement('span');
  testMsg.className = 'smart-macro-testmsg';
  testRow.append(testBtn, guideBtn, testMsg);
  // Pinned below the scrolling body, above the footer.
  box.appendChild(testRow);

  // Footer.
  const foot = document.createElement('div');
  foot.className = 'smart-macro-foot';
  if (editing) {
    const back = document.createElement('button');
    back.className = 'smart-macro-cancel';
    back.textContent = '‹ Back';
    back.addEventListener('click', () => renderManager(null));
    foot.appendChild(back);
  }
  const save = document.createElement('button');
  save.className = 'smart-macro-save';
  save.textContent = editing ? 'Save' : 'Add';
  save.disabled = true;
  save.addEventListener('click', () => {
    const label = labelInput.value.trim();
    const cmds = cmdsInput.value.trim();
    if (!label || !cmds) { labelInput.focus(); return; }
    if (editing) updateMacro(editing.id, { label, cmds, color: chosenColor });
    else addMacro({ id: genId(), label, cmds, color: chosenColor });
    renderSmartBar();
    renderManager(null);
  });
  foot.appendChild(save);
  box.appendChild(foot);

  // Check / gating logic. Both on open and on click (`interactive`) it tidies the
  // commands box — one segment per line (split ";"/newlines), close unclosed ifs,
  // indent block structure — then validates. Formatting is applied regardless of any
  // keyword/operator fixes were found, so existing text shows formatted on open and
  // reformats on every click. On open it does so silently (no status line); on click
  // it reports what it fixed.
  const runCheck = (interactive) => {
    const { text, fixes } = autoFix(cmdsInput.value);
    if (text !== cmdsInput.value) cmdsInput.value = text; // note: programmatic set doesn't fire `input`
    const res = validateMacro(cmdsInput.value);
    save.disabled = !res.ok;
    // Advisories (non-blocking): only meaningful once the structure is valid.
    const warnings = res.ok ? lintMacro(cmdsInput.value) : [];
    testMsg.className = 'smart-macro-testmsg ' + (res.ok ? (warnings.length ? 'warn' : 'ok') : 'err');
    if (!interactive) { testMsg.textContent = ''; return; }
    const prefix = fixes.length ? `Auto-fixed ${fixes.length} issue${fixes.length > 1 ? 's' : ''}. ` : '';
    if (!res.ok) { testMsg.textContent = `${prefix}✕ Line ${res.line}: ${res.error}`; return; }
    // Save stays unlocked; warnings just teach. Show the first, note any extras.
    const warn = warnings.length ? ` ⚠ ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}` : '';
    testMsg.textContent = `${prefix}✓ Ready to add.${warn}`;
  };
  const invalidate = () => {
    save.disabled = true;
    testMsg.textContent = 'Edited — press Check & Fix again.';
    testMsg.className = 'smart-macro-testmsg';
  };
  testBtn.addEventListener('click', () => runCheck(true));
  cmdsInput.addEventListener('input', invalidate);
  runCheck(false); // silent pre-check: valid existing macros stay saveable

  overlay.appendChild(box);
  // Close on backdrop click only when the press *started* on the backdrop, so a
  // drag inside the box that releases outside doesn't dismiss it.
  let downOnOverlay = false;
  overlay.addEventListener('mousedown', (e) => { downOnOverlay = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnOverlay) closeManager(); });
  document.body.appendChild(overlay);
  _overlay = overlay;
  labelInput.focus();
}
