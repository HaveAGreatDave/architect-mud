// SEAT KEYS — the gate for which surface the keyboard belongs to.
//
// `client/game/js/panels/seat-keys.js` decides whether a keypress reaches the 3-D seat or the
// command bar. Every one of its failures is silent and every one of them presents as the game
// ignoring you:
//
//   · A SEAT THAT NEVER CLAIMS leaves the keyboard in the command bar for the session. The picture
//     is perfect, the frame rate is fine, and W/A/S/D types "wasd" into the chat box. Free look and
//     the wheelhouse shipped that way — the three seats that did claim each carried their own copy
//     of the dozen lines, so nothing anywhere said that two of the five were missing them.
//   · A SEAT THAT NEVER ENDS ITS CLAIM leaves a dead pane holding the keyboard after it closes, and
//     input.js then refuses to give the command bar focus on the next letter you type.
//   · A CLAIM BOUND ON THE BUBBLE is beaten by the free camera and nothing says so. That is the one
//     that shipped: `bindFreeCamPointer` binds `pointerdown` on the CAPTURE phase of the glass and
//     calls `stopImmediatePropagation` on what it consumes, so a pane listening on the bubble stops
//     hearing clicks the moment the camera comes off its mount — in the one mode where the keyboard
//     is the entire control scheme.
//
// ⚠ THE SEAT LIST IS DERIVED, NEVER WRITTEN DOWN — the rule bigscreen-smoke.mjs already runs on. A
// seat is a file that calls `windshieldHTML(`, which is the only way to put a world canvas on the
// page, so a sixth one arrives here as a failure rather than as a gap nobody notices.
//
// ⚠ AND THE DOM HERE IS A REAL ONE, small and purpose-built, which is the opposite of what every
// other client smoke does. The shared stub (seat-harness.mjs) answers `addEventListener` with a
// no-op — right for a panel whose behaviour under test is what it paints, and useless for a module
// whose behaviour under test IS event propagation. There is no DOM library in this repo and there
// is not going to be one, so the ~90 lines below implement the only part that matters: capture runs
// root→target, bubble runs target→root, and a listener can stop either.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { blank } from '../lib/blank-scanner.mjs';

const PANELS = 'client/game/js/panels';
const read = (p) => readFileSync(p, 'utf8');
let fails = 0;
const notes = [];
const ck = (name, ok, note) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || note === undefined ? '' : ' — ' + note));
  if (!ok) fails++;
};

// ── A DOM WITH PROPAGATION IN IT ────────────────────────────────────────────
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.id = '';
    this._class = new Set();
    this._on = new Map();       // 'type|capture' → [fn]
    this.textContent = '';
    this.type = '';
    this.isContentEditable = false;
    const self = this;
    this.classList = {
      add: (c) => self._class.add(c),
      remove: (c) => self._class.delete(c),
      contains: (c) => self._class.has(c),
      toggle: (c, on) => { const want = on === undefined ? !self._class.has(c) : !!on; if (want) self._class.add(c); else self._class.delete(c); return want; },
    };
  }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
  appendChild(c) { c.parentNode?.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(k, v) { if (k === 'id') this.id = v; this['_attr_' + k] = v; }
  getAttribute(k) { return k === 'id' ? this.id : (this['_attr_' + k] ?? null); }
  hasAttribute(k) { return k === 'id' ? !!this.id : ('_attr_' + k) in this; }
  addEventListener(t, fn, opts) { const k = t + '|' + (opts === true || opts?.capture ? '1' : '0'); if (!this._on.has(k)) this._on.set(k, []); this._on.get(k).push(fn); }
  removeEventListener(t, fn, opts) { const k = t + '|' + (opts === true || opts?.capture ? '1' : '0'); const a = this._on.get(k); const i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(sel) { for (const n of this.walk()) if (matches(n, sel)) return n; return null; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  focus() { doc._focus(this); }
  blur() { if (doc.activeElement === this) doc._focus(doc.body); }
  click() { dispatch(this, 'click'); }
}
const matches = (n, sel) => (sel.startsWith('.') ? n._class.has(sel.slice(1)) : sel.startsWith('#') ? n.id === sel.slice(1) : n.tagName === sel.toUpperCase());

function dispatch(target, type, extra = {}) {
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  path.push(doc);
  const ev = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  let stop = false, stopNow = false;
  ev.stopPropagation = () => { stop = true; };
  ev.stopImmediatePropagation = () => { stop = true; stopNow = true; };
  const run = (node, capture) => {
    const a = node._on?.get(type + '|' + (capture ? '1' : '0'));
    if (!a) return;
    for (const fn of [...a]) { fn(ev); if (stopNow) return; }
  };
  for (let i = path.length - 1; i >= 0; i--) { run(path[i], true); if (stop) break; }   // capture: root → target
  if (!stop) for (let i = 0; i < path.length; i++) { run(path[i], false); if (stop) break; }   // bubble: target → root
  // The browser's own default for a press: focus what was pressed, unless somebody said not to.
  // Modelled because the ORDER is the thing under test — it runs after every listener above, which
  // is what makes a grab fired on the way down look harmless and feel like a flicker.
  if (type === 'pointerdown' && !ev.defaultPrevented) {
    for (let n = target; n; n = n.parentNode) {
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') { n.focus(); break; }
    }
  }
  return ev;
}

const doc = new El('#document');
doc.documentElement = new El('html');
doc.documentElement.parentNode = null;
doc.body = new El('body');
doc.head = new El('head');
doc.documentElement.appendChild(doc.head);
doc.documentElement.appendChild(doc.body);
doc.createElement = (t) => new El(t);
doc.getElementById = (id) => { for (const n of doc.documentElement.walk()) if (n.id === id) return n; return null; };
doc.querySelector = (s) => doc.documentElement.querySelector(s);
doc.querySelectorAll = () => [];
doc.activeElement = doc.body;
doc._focus = (el) => {
  const old = doc.activeElement;
  if (old === el) return;
  doc.activeElement = el;
  if (old && old !== doc.body) dispatch(old, 'focusout');
  if (el && el !== doc.body) dispatch(el, 'focusin');
};
// `contains` reaches the whole tree, which is what `pane.contains(e.target)` needs of the document.
doc.contains = (n) => doc.documentElement.contains(n);
doc.walk = function* () { yield* doc.documentElement.walk(); };
doc._on = new Map();
doc.addEventListener = El.prototype.addEventListener.bind(doc);
doc.removeEventListener = El.prototype.removeEventListener.bind(doc);

globalThis.document = doc;
// ⚠ THE WINDOW IS A REAL EMITTER, because a seat opening announces itself on it and the listener
// that matters (the d-pad's WASD walk mode, in main.js) lives on the other side of that event. A
// no-op stub here makes a missing announcement look exactly like a working one.
const winOn = new Map();
globalThis.window = {
  addEventListener(t, fn) { (winOn.get(t) || winOn.set(t, []).get(t)).push(fn); },
  removeEventListener() {},
  dispatchEvent(e) { for (const fn of winOn.get(e.type) || []) fn(e); return true; },
};
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
globalThis.matchMedia = () => ({ matches: false });

const mk = (tag, { id, cls, parent = doc.body, type } = {}) => {
  const el = new El(tag);
  if (id) el.id = id;
  if (cls) for (const c of cls.split(' ')) el._class.add(c);
  if (type) el.type = type;
  parent.appendChild(el);
  return el;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── THE MODULE ──────────────────────────────────────────────────────────────
const SK = await import('../../client/game/js/panels/seat-keys.js');

// The page: a command bar, and a seat with a windshield in it.
const cmd = mk('input', { id: 'cmd-input' });
const pane = mk('div', { cls: 'fl-root' });
const glass = mk('div', { cls: 'ws-wrap', parent: pane });
const outside = mk('div', { id: 'log' });

console.log('— who has the keyboard —');
cmd.focus();
ck('no seat → the keyboard is not a seat\'s', SK.seatHoldsKeyboard() === false);

SK.claimSeatKeyboard(pane, { label: 'CAMERA' });
ck('a seat that claims takes it off the command bar', doc.activeElement !== cmd, `activeElement is ${doc.activeElement.tagName}`);
ck('…and holds it', SK.seatHoldsKeyboard() === true);

cmd.focus();
await tick();
ck('clicking into the command bar gives it back', SK.seatHoldsKeyboard() === false);
const tag = doc.getElementById('seat-keys-tag');
ck('…and the glass says so', !!tag && tag.classList.contains('away'), tag ? tag.textContent : 'no tag at all');
ck('…in the seat\'s own picture, not loose on the page', tag?.parentNode === glass);

// ⚠ THE REGRESSION. A seat's own glass stops a pointerdown dead on the CAPTURE phase — this is
// exactly what `bindFreeCamPointer` does, and it is why the three private copies stopped working
// with the camera off its mount. The claim has to survive it.
glass.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }, true);
dispatch(glass, 'pointerdown');
ck('clicking the picture takes the keyboard back', SK.seatHoldsKeyboard() === true);
ck('…even though the free camera swallowed the press', doc.activeElement !== cmd);
await tick();
ck('…and the chip goes quiet again', !doc.getElementById('seat-keys-tag')?.classList.contains('away'));

cmd.focus();
await tick();
dispatch(outside, 'pointerdown');
await tick();
ck('clicking elsewhere on the page does NOT take it back', SK.seatHoldsKeyboard() === false);

// ⚠ A TEXT FIELD INSIDE THE SEAT IS STILL A TEXT FIELD, and it is the case that makes the blur in
// `grabSeatKeys` load-bearing rather than a second way of saying `pane.focus()`: the caret is
// already inside the pane, so the focus half is skipped and only the blur can free the keys.
const seatField = mk('input', { id: 'seat-note', parent: pane });
seatField.focus();
await tick();
// ⚠ AND THE SYMPTOM IS A FLICKER, NOT A REFUSAL, which is why this counts blurs rather than asking
// where the caret ended up. A browser focuses a field as the DEFAULT action of the press, i.e.
// after this module has already run — so a grab that fires anyway blurs the field and the default
// puts it straight back, and what the player gets is the caret jumping to the end of what they
// were editing, an IME composition dropped, and a selection lost, on every click into the box.
let lostIt = 0;
seatField.addEventListener('focusout', () => { lostIt++; });
dispatch(seatField, 'pointerdown');
ck('clicking a text field inside the seat does not snatch it back', doc.activeElement === seatField);
ck('…and does not blur it on the way past', lostIt === 0, `${lostIt} spurious blur(s)`);
ck('…and the seat knows it has lost the keys', SK.seatHoldsKeyboard() === false);
dispatch(glass, 'pointerdown');
ck('…and clicking the picture takes them off it', SK.seatHoldsKeyboard() === true, `activeElement is ${doc.activeElement.tagName}`);
seatField.remove();

// ⚠ A RANGE SLIDER IS NOT SOMEWHERE YOU TYPE — the flight sim's ⚙ tune panel is two dozen of them.
const slider = mk('input', { id: 'tune-lod', type: 'range', parent: pane });
slider.focus();
ck('a focused slider still leaves the keys with the seat', SK.seatHoldsKeyboard() === true);

// Focus on the body — somebody clicked the log — is still the seat's, because the seats listen on
// the window and so it is.
doc._focus(doc.body);
ck('focus on nothing at all is still the seat\'s', SK.seatHoldsKeyboard() === true);

SK.endSeatKeyboard(pane);
ck('a seat that closes hands it back', SK.seatHoldsKeyboard() === false);
ck('…and takes its chip with it', !doc.getElementById('seat-keys-tag'));

// A seat torn out of the page without saying so: the answer has to be about the page as it is.
SK.claimSeatKeyboard(pane, { label: 'CAMERA' });
pane.remove();
ck('a pane ripped out of the document self-heals', SK.seatHoldsKeyboard() === false);
SK.endSeatKeyboard();

// ── THE SEATS ───────────────────────────────────────────────────────────────
// ⚠ RAW SOURCE for the seat scan, and blanked source for the code checks — bigscreen-smoke.mjs's
// own note: `blank` wipes a template literal whole, and three of the four seats build their markup
// as one, so `${windshieldHTML(id, label)}` disappears and with it the seat.
console.log('\n— every seat claims —');
const seats = readdirSync(PANELS)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => read(join(PANELS, f)).includes('windshieldHTML('))
  .filter((f) => f !== 'windshield.js' && f !== 'windshield-lazy.js');

// Where each seat's claim lives, and why it is not always the file that paints. An entry is a
// REASON, never a name.
const OWNER = {
  'cab-view.js': { owner: 'cab-view.js', why: 'the truck cab paints and takes its own keys' },
  'cockpit.js': { owner: 'cockpit.js', why: 'the flight sim and the charter cabin, one file, two mounts' },
  'freelook-view.js': { owner: 'freelook-view.js', why: 'the camera with no vehicle under it' },
  'helm-view.js': { owner: 'helm-mode.js', why: 'helm-view paints the chase; helm-mode owns .helm-root and closeHelm' },
  'boat-view.js': { owner: 'boat-view.js', why: 'the race boat paints and owns .boat-root, its own chrome and closeBoat — the cab arrangement, not the wheelhouse split' },
};
if (!seats.length) { ck('found any seats at all', false, 'has windshieldHTML been renamed?'); }
const owners = new Set();
for (const f of seats) {
  const o = OWNER[f];
  if (!o) { ck(`${f} is accounted for`, false, 'mounts a windshield with no OWNER entry — say which file takes its keyboard, with a reason'); continue; }
  owners.add(o.owner);
  const code = blank(read(join(PANELS, o.owner)));
  ck(`${f} → ${o.owner} claims the keyboard`, code.includes('claimSeatKeyboard('), o.why);
  ck(`${f} → ${o.owner} hands it back on close`, code.includes('endSeatKeyboard('), o.why);
}
notes.push(`seats: ${seats.join(', ')}`);
notes.push(`claim owners: ${[...owners].join(', ')}`);

// ── ONE IMPLEMENTATION ──────────────────────────────────────────────────────
// The thing this replaced was the same dozen lines in three files, two of them without a readout
// and all three bound where the free camera beats them. A fourth copy is how that comes back.
console.log('\n— one implementation —');
for (const f of [...owners]) {
  const code = blank(read(join(PANELS, f)));
  const copy = /getElementById\(\s*'cmd-input'\s*\)[\s\S]{0,120}?\.blur\(\)/.test(code);
  ck(`${f} keeps no private copy of the focus dance`, !copy,
    'blurs #cmd-input itself — that is seat-keys.js\'s job, and a copy bound on this file\'s own pane is one the free camera swallows');
}

// ── THE SEAT SAYS SO OUT LOUD ───────────────────────────────────────────────
// The location d-pad has a WASD walk mode that binds W/A/S/D on the window. While a seat is up
// those letters are steering it, so the mode is disarmed and its button disabled — and the only
// thing that tells main.js a seat opened is this event. Miss it and the button sits armed over
// keys it is not getting, which is the same silent class as everything else in this file.
console.log(String.fromCharCode(10) + "— the seat announces itself —");
const heard = [];
window.addEventListener("seat:keyboard", (e) => heard.push(!!e.detail?.seated));
// A pane of its own: an earlier case above detaches the shared one, and a detached pane is a seat
// that has already gone — which would make this claim honestly announce nothing.
const livePane = mk("div", { cls: "fl-root" });
mk("div", { cls: "ws-wrap", parent: livePane });
SK.claimSeatKeyboard(livePane, { label: "CAMERA" });
ck("claiming announces seated", heard.at(-1) === true, "nothing told the WASD walk mode to stand down");
SK.endSeatKeyboard(livePane);
ck("ending announces unseated", heard.at(-1) === false, "the button stays disabled after the seat closes");

const mainJs = blank(read("client/game/js/main.js"));
ck("main.js listens for it", /seat:keyboard/.test(mainJs),
  "the event fires and nothing is on the other end of it");
ck("…and the WASD keydown guard asks seatHoldsKeyboard()", mainJs.includes("seatHoldsKeyboard()"),
  "a seat not on the hand-written panel list has its W/A/S/D eaten and walks the player instead");

// ── AND input.js ASKS THE DERIVED QUESTION ──────────────────────────────────
console.log('\n— the auto-focus guard —');
const inputJs = blank(read('client/game/js/input.js'));
ck('input.js guards its auto-focus on seatHoldsKeyboard()', inputJs.includes('seatHoldsKeyboard()'),
  'without it a letter pressed in a seat that is not on its hand-written list pulls focus into the command bar and types itself');

for (const n of notes) console.log('  · ' + n);
if (fails) { console.error(`\n✗ seatkeys:smoke — ${fails} problem(s)`); process.exit(1); }
console.log('\n✓ seatkeys:smoke — the keyboard follows the click, survives the free camera, and every seat claims and releases it.');
