// The environmental control screen (plugins/envcontrol): lights, climate and the camera over the
// door, docked over whatever's open (the Room Stage, usually) or full screen. It holds no logic:
// every button sends a typeable verb (`lights on`, `thermostat 22`, `doorcam`, `panel refresh`) and
// it redraws from the state each answer carries.

import { sendCmd, sendCmdSilent } from '../net.js';
import { loadCss, escapeHtml } from '../../../shared/dom.js';

const css = loadCss(new URL('./envctl.css', import.meta.url));
const REFRESH_MS = 4000;
let root = null, last = null, timer = 0, full = false;

const esc = (s) => escapeHtml(String(s ?? ''));

async function mount() {
  if (root) return root;
  const style = document.createElement('style');
  style.textContent = await css;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.className = 'envctl';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Control panel');
  document.body.appendChild(root);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd],[data-ui]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.ui === 'full') { full = !full; draw(); return; }
    if (b.dataset.ui === 'close') { close(true); return; }
    sendCmd(b.dataset.cmd);
  });
  // the room's keys stay the room's, except Esc, which puts the screen away first
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root || root.hidden) return;
    e.stopPropagation(); e.preventDefault();
    if (full) { full = false; draw(); } else close(true);
  }, true);
  return root;
}

function draw() {
  if (!root || !last) return;
  const s = last, c = s.climate || {}, lit = (s.lights || []).filter((l) => l.on).length, dark = s.power === 'unpowered';
  const cam = s.cam || {};
  const camBody = cam.frame
    ? `<div class="envctl-frame">${esc(cam.frame)}</div>`
    : `<div class="envctl-frame envctl-nosig">${cam.status === 'none' ? 'NO CAMERA FITTED' : `NO SIGNAL · ${esc(String(cam.status || '').toUpperCase())}`}</div>`;
  root.classList.toggle('envctl-full', full);
  root.innerHTML = `
    <header class="envctl-head">
      <span class="envctl-name">${esc(s.name)}</span>
      ${dark ? '<span class="envctl-warn">NO POWER</span>' : ''}
      <button type="button" data-ui="full" title="${full ? 'Dock' : 'Full screen'}" aria-label="${full ? 'Dock' : 'Full screen'}">${full ? '▣' : '⛶'}</button>
      <button type="button" data-ui="close" title="Close" aria-label="Close">✕</button>
    </header>
    <div class="envctl-body">
      <section class="envctl-tile">
        <h3>Lights</h3>
        <div class="envctl-big ${lit ? 'on' : ''}">${lit ? 'ON' : 'OFF'}<small>${lit}/${(s.lights || []).length}</small></div>
        <div class="envctl-row">
          <button type="button" data-cmd="lights on" ${lit === (s.lights || []).length ? 'class="sel"' : ''}>On</button>
          <button type="button" data-cmd="lights off" ${!lit ? 'class="sel"' : ''}>Off</button>
        </div>
        <ul class="envctl-list">${(s.lights || []).map((l) => `<li class="${l.on ? 'on' : ''}">${esc(l.name)}</li>`).join('')}</ul>
      </section>
      <section class="envctl-tile">
        <h3>Climate</h3>
        <div class="envctl-big">${Number.isFinite(c.now) ? Math.round(c.now * 10) / 10 : '--'}<small>°C now</small></div>
        <div class="envctl-row">
          <button type="button" data-cmd="thermostat down" aria-label="Cooler">−</button>
          <span class="envctl-set">${c.target == null ? 'OFF' : `${c.target}°C`}</span>
          <button type="button" data-cmd="thermostat up" aria-label="Warmer">+</button>
        </div>
        <div class="envctl-row">
          <button type="button" data-cmd="thermostat ${c.target == null ? 21 : 'off'}">${c.target == null ? 'Climate on' : 'Climate off'}</button>
        </div>
      </section>
      <section class="envctl-tile envctl-cam">
        <h3>Door <span class="envctl-live">${cam.frame ? '● LIVE' : ''}</span></h3>
        <div class="envctl-where">${esc(cam.label || '')}</div>
        ${camBody}
        <div class="envctl-row"><button type="button" data-cmd="doorcam">Snapshot to log</button></div>
      </section>
    </div>`;
}

function poll() {
  clearInterval(timer);
  timer = setInterval(() => { if (root && !root.hidden && !document.hidden) sendCmdSilent('panel refresh'); }, REFRESH_MS);
}

export function close(tell = false) {
  if (!root) return;
  root.hidden = true; full = false;
  clearInterval(timer); timer = 0;
  if (tell) sendCmdSilent('panel close');
}

// Every answer from the panel's verbs comes here. `open` (from `panel`) brings the screen up; the
// others redraw it if it's up and leave it shut if it isn't.
export async function onEnvctl(msg) {
  if (msg.close) { close(false); return; }
  last = msg;
  if (!msg.open && (!root || root.hidden)) return;
  await mount();
  root.hidden = false;
  draw();
  if (!timer) poll();
}

export const isEnvctlOpen = () => !!root && !root.hidden;
