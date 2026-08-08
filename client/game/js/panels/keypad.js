// CONCEALMENT KEYPAD — the panel on a Cachet-style discretion cabinet
// (plugins/concealment). A numeric pad, four to eight digits, masked as you type.
//
// The privacy rule this overlay exists to keep: the digits NEVER touch the message
// log. Submitting goes out through sendCmdSilent, so there's no echoed command line
// for a screenshot, a scrollback or a shoulder to read — which is the whole reason
// the code is a code. The cabinet OPENING is public (the server broadcasts that to
// the room); what you pressed to open it is not.
//
// Deliberately not a minigame: there's no skill roll and no timer here. Knowing the
// code is the entire check, so the pad's only job is to take the digits and get out
// of the way.

import { sfx, esc, mountOverlay, ensureChassisStyles } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';

const MAX_DIGITS = 8;
const MIN_DIGITS = 4;

function ensureStyles() {
  if (document.getElementById('keypad-styles')) return;
  const s = document.createElement('style');
  s.id = 'keypad-styles';
  s.textContent = `
    #keypad-overlay { --kp-accent:#c8a15a; --mg-accent:#c8a15a; position:fixed; inset:0; z-index:9200;
      display:flex; align-items:center; justify-content:center;
      background:rgba(2,3,4,0.72); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #keypad-overlay .kp-panel { width:min(320px,90vw); color:var(--kp-accent); padding:14px 16px 16px;
      background:linear-gradient(180deg, #3a3730 0%, #2b2822 8%, #1a1815 14%, #0c0b09 100%);
      border:1px solid rgba(200,161,90,.34); border-radius:4px;
      box-shadow:0 18px 50px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
      animation:kp-boot .22s ease-out; }
    @keyframes kp-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #keypad-overlay .kp-brand { font-size:0.6875rem; letter-spacing:2.5px; text-transform:uppercase; color:#8d7a52; }
    #keypad-overlay .kp-state { font-size:0.625rem; letter-spacing:2px; text-transform:uppercase; color:#6f6252; }
    #keypad-overlay .kp-readout { margin:10px 0 12px; height:1.545em; display:flex; align-items:center; justify-content:center;
      letter-spacing:12px; font-size:1.375rem; color:#f0dca8; text-indent:12px;
      background:#0a0908; border:1px solid rgba(200,161,90,.28); border-radius:3px;
      box-shadow:inset 0 0 14px rgba(200,161,90,.12); }
    #keypad-overlay .kp-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
    #keypad-overlay .kp-key { padding:11px 0; text-align:center; font-size:1.0625rem; color:#e6d3a6; cursor:pointer;
      background:linear-gradient(180deg,#2a2721,#16150f); border:1px solid rgba(200,161,90,.26); border-radius:3px;
      user-select:none; transition:background .1s, border-color .1s, transform .05s; }
    #keypad-overlay .kp-key:hover { border-color:rgba(200,161,90,.6); background:linear-gradient(180deg,#332f27,#1b1913); }
    #keypad-overlay .kp-key:active { transform:translateY(1px); }
    #keypad-overlay .kp-key.kp-wide { grid-column:span 3; font-size:0.8125rem; letter-spacing:2px; }
    #keypad-overlay .kp-key.kp-go { color:#8fe0a0; border-color:rgba(143,224,160,.4); }
    #keypad-overlay .kp-msg { margin-top:10px; min-height:1.364em; font-size:0.6875rem; letter-spacing:.5px; color:#8d7a52; text-align:center; }
    #keypad-overlay .kp-msg.kp-bad { color:#ff6b7f; }
    #keypad-overlay .kp-foot { margin-top:8px; font-size:0.625rem; letter-spacing:1px; color:#5f5541; text-align:center; }
    #keypad-overlay .kp-foot span { cursor:pointer; text-decoration:underline; }
  `;
  document.head.appendChild(s);
}

// mode: 'enter' (open/seal) or 'change' (old code, then new code)
export function openConcealKeypad(msg) {
  ensureChassisStyles?.();
  ensureStyles();
  let digits = '';
  let mode = 'enter';
  let oldCode = '';   // held in memory only, for the change-code second step

  const { overlay, close } = mountOverlay({
    id: 'keypad-overlay',
    html: `<div class="kp-panel">
      <div class="kp-brand">${esc(msg.brand || 'KEYPAD')}</div>
      <div class="kp-state" id="kp-state"></div>
      <div class="kp-readout" id="kp-readout"></div>
      <div class="kp-grid" id="kp-grid"></div>
      <div class="kp-msg" id="kp-msg"></div>
      <div class="kp-foot" id="kp-foot"></div>
    </div>`,
    onKey: (e, doClose) => {
      if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { digits = digits.slice(0, -1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { submit(); e.preventDefault(); }
    },
  });

  const $ = (id) => overlay.querySelector('#' + id);

  function press(d) {
    if (digits.length >= MAX_DIGITS) return;
    digits += d;
    sfx('vault-tick');   // the catalogue's existing dial click — a keypad needs no new sound
    paint();
  }

  function say(text, bad) {
    const el = $('kp-msg');
    el.textContent = text || '';
    el.classList.toggle('kp-bad', !!bad);
  }

  function submit() {
    if (digits.length < MIN_DIGITS) { say(`${MIN_DIGITS} digits minimum.`, true); return; }
    if (mode === 'change' && !oldCode) {
      // Step one of a change: hold the current code, then take the new one. The
      // server checks both together, so a wrong old code fails at step two — the
      // pad never confirms a guess on its own.
      oldCode = digits; digits = ''; paint();
      say('New code.');
      return;
    }
    if (mode === 'change') {
      sendCmdSilent(`concealsetcode ${msg.furnitureId} ${oldCode} ${digits}`);
    } else {
      sendCmdSilent(`concealcode ${msg.furnitureId} ${digits}`);
    }
    close();
  }

  function paint() {
    $('kp-readout').textContent = '•'.repeat(digits.length);
    $('kp-state').textContent = mode === 'change'
      ? (oldCode ? 'SET NEW CODE' : 'CURRENT CODE')
      : (msg.open ? 'ARMED — SEAL' : 'LOCKED — OPEN');
  }

  const grid = $('kp-grid');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '↵']) {
    const b = document.createElement('div');
    b.className = 'kp-key' + (k === '↵' ? ' kp-go' : '');
    b.textContent = k;
    b.addEventListener('click', () => {
      if (k === '⌫') { digits = digits.slice(0, -1); paint(); }
      else if (k === '↵') submit();
      else press(k);
    });
    grid.appendChild(b);
  }

  const foot = $('kp-foot');
  foot.innerHTML = `<span id="kp-change">change code</span> · esc to walk away`;
  $('kp-change').addEventListener('click', () => {
    mode = 'change'; oldCode = ''; digits = '';
    say('Enter the current code first.');
    paint();
  });

  paint();
  if (msg.message) say('');
}
