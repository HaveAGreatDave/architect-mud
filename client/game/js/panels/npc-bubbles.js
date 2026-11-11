// What NPCs say, in chat bubbles along the bottom of the screen and out loud in a voice of their own
// (docs/proposals/room-stage.md, "People at home").
//
// It reads the `.speech-line` the server already sends, so every way an NPC talks comes through here
// with no change to the sender, and the log keeps its copy. The voice is ORACLE's, rolled from the
// name (`voiceFromName`), and content:lint keeps names unique, so a voice is one person's and stays
// theirs. Lines queue on the `npc` channel, so two people talking take turns.
//
// ⚠ THE LOG IS THE ONE LIVE REGION (systems-display-mode.md), so the bubbles are aria-hidden, and the
// `log` rung gets neither bubble nor voice.

import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./npc-bubbles.css', import.meta.url));
const MOST = 3, MIN_S = 3.2, PER_CHAR_S = 0.055;

const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

let host = null;
function hostEl() {
  if (host?.isConnected) return host;
  if (!document.getElementById('npc-bubbles-css')) {
    const s = document.createElement('style');
    s.id = 'npc-bubbles-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  host = document.createElement('div');
  host.id = 'npc-bubbles';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  return host;
}

// Above the command line when it's on screen, and clear of the Stage's tip when that's up.
function lift(el) {
  const input = document.getElementById('input-area')?.getBoundingClientRect();
  const stage = document.getElementById('room-stage');
  el.style.bottom = (stage ? 44 : input?.height ? Math.max(12, innerHeight - input.top + 8) : 12) + 'px';
}

function bubble(name, text, seconds) {
  const el = hostEl();
  lift(el);
  while (el.children.length >= MOST) el.firstChild.remove();
  const b = document.createElement('div');
  b.className = name ? 'npc-bubble' : 'npc-bubble npc-scene';
  if (name) {
    b.style.setProperty('--who', `hsl(${hashOf(name) % 360} 70% 72%)`);
    const n = document.createElement('b');
    n.textContent = name;
    b.append(n);
  }
  const t = document.createElement('span');
  t.textContent = text;
  b.append(t);
  el.append(b);
  setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 300); }, seconds * 1000);
}

// A line off the set on the wall (room-tv.js): the picture is a few feet away and too small to read, so
// what's said on it goes along the bottom with the room's own. The TV has already voiced it.
export function tvLine(name, text) {
  const t = String(text || '').trim();
  if (t) bubble(name, t, Math.max(MIN_S, t.length * PER_CHAR_S));
}

// A third of the city talks RP, off the same name, so the accent is theirs too.
// The voice's own timing goes out with the line, so a figure on the Stage can move its mouth to it.
const say = (name, text, queue) => {
  const trace = [], res = window.AudioEngine?.speak?.(text, { channel: 'npc', seed: name, queue, trace, accent: hashOf(name) % 3 === 0 ? 'rp' : undefined });
  window.dispatchEvent(new CustomEvent('npc:voice', { detail: { name, text, trace: res ? trace : null, delay: res ? res.delay : 0 } }));
  return res;
};

// One line off the wire. Speech gets a bubble and a voice; anything else only reaches here with the
// Stage up, and gets a bubble with no name on it.
export function heard(html, rung) {
  if (rung === 'log') return;
  const doc = new DOMParser().parseFromString(html, 'text/html'), line = doc.querySelector('.speech-line');
  if (!line) {
    const text = doc.body.textContent.trim();
    if (text) bubble('', text, Math.max(MIN_S, text.length * PER_CHAR_S));
    // the Stage acts it out on whoever's name it starts with (client/shared/npc-acts.js)
    if (text) window.dispatchEvent(new CustomEvent('npc:line', { detail: { text } }));
    return;
  }
  // a yell carries from next door, and may be a player's
  if (line.matches('.yell, .distant')) return;
  const m = /^(.+?) \w+, "([\s\S]*)"$/.exec(line.textContent.trim()) || /^([^:"]+): ([\s\S]+)$/.exec(line.textContent.trim());
  if (!m || /^you$/i.test(m[1])) return;
  const [, name, text] = m, res = say(name, text, true);
  const seconds = Math.max(MIN_S, text.length * PER_CHAR_S, res ? res.delay + res.duration + 0.6 : 0);
  // the Stage sets `over` when it's showing the line over the speaker's head
  const detail = { name, text, ms: Math.max(seconds - 0.6, res ? res.delay + res.duration : 0) * 1000, over: false };
  window.dispatchEvent(new CustomEvent('npc:speaking', { detail }));
  if (!detail.over) bubble(name, text, seconds);
}

// A line in a conversation: the panel already shows it, so only the voice, and the next line cuts it off.
export function voiceLine(name, text, rung) {
  const t = String(text || '').trim();
  if (rung !== 'log' && name && t) say(name, t, false);
}
