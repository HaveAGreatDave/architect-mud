// CONCEALMENT KEYPAD — the panel on a Cachet-style discretion cabinet
// (plugins/concealment). A numeric pad, four to eight digits, masked as you type.
// The cabinet passes for a home bar, so the pad does too: every key is a drink
// thing (a shot glass for 1, three olives on a pick for 3, a lime of eight
// segments for 8) and nothing else. No digit is printed anywhere on it: the code
// is where you press, as on any pad, and the keyboard's digits still work. The
// reset key is a bar's last-orders bell.
//
// It's a backlit panel of smoked glass in a brass bezel (keypad.css), big enough to
// hit with a thumb: round keys lit amber from behind, which dip when pressed (by mouse,
// touch or keyboard). A click off the panel, the close button or Escape puts it away. Nothing in a key's look carries meaning the aria-label doesn't.
//
// The privacy rule this overlay exists to keep: the digits NEVER touch the message
// log. Submitting goes out through sendCmdSilent, so there's no echoed command line
// for a screenshot, a scrollback or a shoulder to read — which is the whole reason
// the code is a code. The cabinet OPENING is public (the server broadcasts that to
// the room); what you pressed to open it is not.
//
// The SERVER decides every code. The pad opens at the stage the server names
// (msg.stage): 'enter' to work the wall, 'setup' when a right code was still the
// factory one and a code of your own is wanted first, 'new' when the reset key's
// current code checked out. The code you typed to get there is held here, in
// memory, for the minute it takes to pick the next one, because the server checks
// it again with the new code; nothing about whether it was right is decided here.
//
// Deliberately not a minigame: there's no skill roll and no timer here. Knowing the
// code is the entire check, so the pad's only job is to take the digits and get out
// of the way.

import { sfx, esc, mountOverlay, ensureChassisStyles } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';
import { loadCss } from '../../../shared/dom.js';

const MAX_DIGITS = 8;
const MIN_DIGITS = 4;
const HOLD_MS = 120000;   // how long the code you just typed is kept for the next stage

// Fetched once when the module loads and awaited when the pad first opens, so the
// game's boot doesn't wait on it (dispatch.js imports this statically).
const CSS = loadCss(new URL('./keypad.css', import.meta.url));

// The keys. Each digit's icon is a bar thing, and where one fits, it counts: one shot,
// two glasses, three olives, four cubes of ice, a six-pack, a lime of eight segments, a
// bottle cap round as a nought. Drawn on a 24 grid in the key's brass, stroke only.
const ICONS = {
  1: { name: 'shot glass', svg: "<path d='M7.5 5h9l-1.4 13.2a1 1 0 0 1-1 .8H9.9a1 1 0 0 1-1-.8z'/><path d='M8.3 10.5h7.4l-.85 8H9.15z' fill='currentColor' opacity='.3' stroke='none'/>" },
  2: { name: 'two glasses', svg: "<g transform='rotate(-14 8 14)'><path d='M5 8h6l-.8 10H5.8z'/><path d='M5.3 12h5.4'/></g><g transform='rotate(14 16 14)'><path d='M13 8h6l-.8 10h-4.4z'/><path d='M13.3 12h5.4'/></g><path d='M12 2.5v2.2M9.2 3.6l1.1 1.6M14.8 3.6l-1.1 1.6'/>" },
  3: { name: 'three olives', svg: "<path d='M3.5 20.5 20 4'/><path d='M20 4l.9-2.1M20 4l2.1-.9'/><circle cx='7.6' cy='16.4' r='2.4'/><circle cx='11.6' cy='12.4' r='2.4'/><circle cx='15.6' cy='8.4' r='2.4'/><circle cx='8.4' cy='15.6' r='.8' fill='currentColor'/><circle cx='12.4' cy='11.6' r='.8' fill='currentColor'/><circle cx='16.4' cy='7.6' r='.8' fill='currentColor'/>" },
  4: { name: 'ice', svg: "<rect x='3.5' y='4' width='7.5' height='7.5' rx='1.6' transform='rotate(-8 7.25 7.75)'/><rect x='13' y='3.5' width='7.5' height='7.5' rx='1.6' transform='rotate(6 16.75 7.25)'/><rect x='4' y='13' width='7.5' height='7.5' rx='1.6' transform='rotate(5 7.75 16.75)'/><rect x='12.8' y='12.8' width='7.5' height='7.5' rx='1.6' transform='rotate(-6 16.55 16.55)'/><path d='M5.6 6.2l1.4-.2M15 5.6l1.4.1M6.1 15.2l1.4.1M14.8 14.9l1.4-.2'/>" },
  5: { name: 'shaker', svg: "<path d='M10.5 2.5h3v2h-3z'/><path d='M9.2 4.5h5.6l.9 4H8.3z'/><path d='M7.6 8.5h8.8l-1.1 12a1 1 0 0 1-1 .9H9.7a1 1 0 0 1-1-.9z'/><path d='M8 12.5h8'/>" },
  6: { name: 'six-pack', svg: "<path d='M5.5 3.5h2v3l1.3 2.2V11H4.2V8.7l1.3-2.2z'/><path d='M11 3.5h2v3l1.3 2.2V11H9.7V8.7L11 6.5z'/><path d='M16.5 3.5h2v3l1.3 2.2V11h-4.6V8.7l1.3-2.2z'/><path d='M3 11h18v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'/><path d='M3 15h18'/>" },
  7: { name: 'martini', svg: "<path d='M4.5 4.5h15L12 13z'/><path d='M12 13v7M8.5 20.5h7'/><path d='M6.6 6.8h10.8' opacity='.5'/><path d='M16.5 2.5l-3.4 6'/><circle cx='14.2' cy='6.6' r='1.3'/>" },
  8: { name: 'lime', svg: "<circle cx='12' cy='12' r='8.5'/><circle cx='12' cy='12' r='6.6'/><path d='M6 12h12M12 6v12M7.76 7.76l8.48 8.48M16.24 7.76l-8.48 8.48'/>" },
  9: { name: 'wine bottle', svg: "<path d='M10.5 2.5h3v4.2c0 1.2 2.7 2.2 2.7 5v8.8a1 1 0 0 1-1 1H8.8a1 1 0 0 1-1-1v-8.8c0-2.8 2.7-3.8 2.7-5z'/><path d='M7.8 13.5h8.4V18H7.8z'/><path d='M10.5 4.5h3'/>" },
  0: { name: 'bottle cap', svg: "<circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='8.6' stroke-dasharray='2.2 1.4'/><circle cx='12' cy='12' r='3.4' opacity='.4'/>" },
  back: { name: 'spill', word: 'back', svg: "<g transform='rotate(-70 12 11)'><path d='M8 4.5h8l-1.1 11H9.1z'/></g><path d='M3 20.5c2.5-1.2 6.5-1.4 10-.3 2 .6 4.5.6 7.5-.2'/><path d='M17.6 14.6v.4M19.6 16.6v.4'/>" },
  enter: { name: 'pour', word: 'enter', svg: "<g transform='rotate(30 9 7.5)'><path d='M2.5 5h9.5l2.2 1.6h2.8v1.8h-2.8L12 10H2.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'/></g><path d='M16 12.3v2.4'/><path d='M13 15.5h6l-.8 5.5h-4.4z'/>" },
  reset: { name: 'last orders bell', svg: "<path d='M5.5 17c1.2-1.4 1.5-3 1.5-6a5 5 0 0 1 10 0c0 3 .3 4.6 1.5 6z'/><path d='M10.3 19.5a1.8 1.8 0 0 0 3.4 0'/><path d='M12 3.5V6'/><path d='M4 17h16'/>" },
};
const icon = (k) => `<svg class='kp-ico' viewBox='0 0 24 24' aria-hidden='true'>${ICONS[k].svg}</svg>`;
// A key's face: the lit glass disc the icon sits in (keypad.css).
const cap = (inner) => `<span class="kp-cap">${inner}</span>`;
const PIPS = MAX_DIGITS;
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// the code typed at the last stage, for the next one: { id, code, until }
let held = null;
const heldFor = (id) => (held && held.id === id && held.until > Date.now() ? held.code : null);
const hold = (id, code) => { held = { id, code, until: Date.now() + HOLD_MS }; };

let sheetIn = false;
async function ensureStyles() {
  if (sheetIn || document.getElementById('keypad-styles')) return;
  const css = await CSS;
  if (document.getElementById('keypad-styles')) return;
  const s = document.createElement('style');
  s.id = 'keypad-styles';
  s.textContent = css;
  document.head.appendChild(s);
  sheetIn = true;
}

// Stages, by what the pad is doing:
//   enter    the code, to open or seal
//   current  the reset key: the code now, which the server checks before asking for a new one
//   setup    the server's: a right factory code, and a code of your own wanted before it opens
//   new      the server's: the reset's current code was right, so a new one
// 'setup' and 'new' take the new code twice, so a slip of the finger doesn't lock you out.
export async function openConcealKeypad(msg) {
  ensureChassisStyles?.();
  await ensureStyles();
  document.getElementById('keypad-overlay')?.remove();
  const id = msg.furnitureId;
  let mode = msg.stage === 'setup' || msg.stage === 'new' ? msg.stage : 'enter';
  // the server asked for a new code, but the one that got us here has gone (it's held
  // two minutes): back to the start, rather than send a set the server will refuse
  if (mode !== 'enter' && !heldFor(id)) mode = 'enter';
  let digits = '';
  let first = '';   // a new code's first entry, while it's typed again

  const { overlay, close } = mountOverlay({
    id: 'keypad-overlay',
    html: `<div class="kp-stage">
      <div class="kp-dev${reducedMotion() ? ' kp-still' : ''}" id="kp-dev" role="dialog" aria-label="${esc(msg.brand || 'Keypad')}">
        <div class="kp-plate">
          <div class="kp-head"><span class="kp-lamp" aria-hidden="true"></span><span class="kp-brand">${esc(msg.brand || 'KEYPAD')}</span><button type="button" class="kp-x" id="kp-x" aria-label="Close the keypad" title="Close (Esc)">&times;</button></div>
          <div class="kp-screen" id="kp-screen">
            <div class="kp-state" id="kp-state"></div>
            <div class="kp-pips" id="kp-readout" role="status" aria-live="polite"></div>
          </div>
          <div class="kp-grid" id="kp-grid"></div>
          <div class="kp-msg" id="kp-msg" aria-live="polite"></div>
          <div class="kp-foot"><button type="button" class="kp-key kp-reset" id="kp-reset" aria-label="Reset the code (last orders bell)" title="Reset the code: the current code, then a new one">${cap(icon('reset'))}</button><span class="kp-esc">Enter pours &middot; Esc walks away</span></div>
        </div>
      </div>
    </div>`,
    onKey: (e) => {
      if (/^[0-9]$/.test(e.key)) { press(e.key); flashKey(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { back(); flashKey('back'); e.preventDefault(); }
      else if (e.key === 'Enter') { submit(); flashKey('enter'); e.preventDefault(); }
    },
  });

  const $ = (sel) => overlay.querySelector('#' + sel);

  function press(d) {
    if (digits.length >= MAX_DIGITS) return;
    digits += d;
    sfx('vault-tick');   // the catalogue's existing dial click — a keypad needs no new sound
    paint();
  }
  function back() { digits = digits.slice(0, -1); paint(); }

  function say(text, bad) {
    const el = $('kp-msg');
    el.textContent = text || '';
    el.classList.toggle('kp-bad', !!bad);
    // the screen blinks red with it, and settles back
    const scr = $('kp-screen');
    scr.classList.remove('kp-bad');
    if (bad) { void scr.offsetWidth; scr.classList.add('kp-bad'); }
  }

  function submit() {
    if (digits.length < MIN_DIGITS) { say(`${MIN_DIGITS} digits minimum.`, true); return; }
    if (mode === 'enter') {
      hold(id, digits);
      sendCmdSilent(`concealcode ${id} ${digits}`);
      close();
      return;
    }
    if (mode === 'current') {
      hold(id, digits);
      sendCmdSilent(`concealsetcode ${id} ${digits}`);
      close();
      return;
    }
    // setup / new: the new code twice
    if (!first) { first = digits; digits = ''; paint(); say('Again, to be sure.'); return; }
    if (digits !== first) { first = ''; digits = ''; paint(); say("They didn't match. Start again.", true); return; }
    const old = heldFor(id);
    held = null;
    sendCmdSilent(`concealsetcode ${id} ${old} ${digits}`);
    close();
  }

  // eight lamps in the screen, one lit per digit
  const pipsEl = $('kp-readout');
  pipsEl.innerHTML = '<i class="kp-pip"></i>'.repeat(PIPS);
  const pips = [...pipsEl.children];

  function paint() {
    pips.forEach((p, i) => p.classList.toggle('on', i < digits.length));
    pipsEl.setAttribute('aria-label', `${digits.length} of ${MAX_DIGITS} digits`);
    const st = $('kp-state');
    st.textContent = mode === 'setup' ? (first ? 'Your code again' : 'Factory code. Set your own')
      : mode === 'new' ? (first ? 'Reset: new code again' : 'Reset: new code')
        : mode === 'current' ? 'Reset: current code'
          : (msg.open ? 'Armed: seal' : 'Locked: open');
    st.classList.toggle('kp-setup', mode === 'setup');
    $('kp-reset').hidden = mode !== 'enter';
  }

  // A key goes down while it's held (mouse or touch), and for a moment when it's typed.
  function flashKey(k) {
    const b = overlay.querySelector(`.kp-key[data-k="${k}"]`);
    if (!b) return;
    b.classList.add('kp-down');
    clearTimeout(b._up);
    b._up = setTimeout(() => b.classList.remove('kp-down'), 130);
  }
  function holdable(b) {
    const up = () => b.classList.remove('kp-down');
    b.addEventListener('pointerdown', () => { clearTimeout(b._up); b.classList.add('kp-down'); });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  }

  const grid = $('kp-grid');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter']) {
    const ic = ICONS[k];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kp-key' + (k === 'enter' ? ' kp-go' : k === 'back' ? ' kp-back' : '');
    b.dataset.k = k;
    // the digit is for a screen reader only; the face shows the symbol and nothing else
    b.setAttribute('aria-label', ic.word ? `${ic.word} (${ic.name})` : `${k} (${ic.name})`);
    b.title = ic.word ? ic.word[0].toUpperCase() + ic.word.slice(1) : ic.name[0].toUpperCase() + ic.name.slice(1);
    b.innerHTML = cap(icon(k));
    holdable(b);
    b.addEventListener('click', () => {
      if (k === 'back') back();
      else if (k === 'enter') submit();
      else press(k);
    });
    grid.appendChild(b);
  }
  holdable($('kp-reset'));

  // put away by its close button, or a click anywhere off the panel
  $('kp-x').addEventListener('click', () => close());
  overlay.addEventListener('pointerdown', (e) => { if (!$('kp-dev').contains(e.target)) close(); });

  $('kp-reset').addEventListener('click', () => {
    mode = 'current'; digits = ''; first = '';
    say('The current code first.');
    paint();
  });

  paint();
  if (mode === 'setup') say('Pick a code of your own, 4 to 8 digits. The factory code stops working.');
  else if (mode === 'new') say('Pick the new code, 4 to 8 digits.');
}
