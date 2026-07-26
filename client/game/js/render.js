import { state } from './state.js';
import { updateBodyTempHUD } from './panels/environment.js';
import { refreshCustomPanels } from './panels/custom/manager.js';
import { registerList, mountScopeToggle } from './panels/list-reorder.js';
import { renderSmartBar } from './panels/smartbar.js';
import { burnBehind } from './flame.js';

// Make the Vitals list reorderable. Call after initSidebarOrder, which reparents
// the section's rows into a .sidebar-section-body (the real row container).
export function initVitalsReorder() {
  const body = document.querySelector('#vitals-section .sidebar-section-body')
    || document.getElementById('vitals-section');
  if (!body) return;
  mountScopeToggle('vitals', document.getElementById('vitals-edit-host'));
  registerList(body, { scope: 'vitals', key: 'vitals', rowSelector: '.vital' });
}

export function appendMsg(text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.textContent = text;
  document.getElementById('output').appendChild(el);
  scrollOutput();
  return el;
}

export function appendHtml(html, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.innerHTML = html;
  document.getElementById('output').appendChild(el);
  // Hero-poster mural reveal: the CSS burns the glyphs, this puts real fire
  // behind them. Mounted after the node is in the document so it can be measured.
  el.querySelectorAll('.mural-word').forEach(w => burnBehind(w));
  scrollOutput();
  return el;
}

// A transient "aircraft overhead" banner pinned to the top of the room pane. It lives
// in #output-container (which doesn't scroll and survives room-look refreshes), fades in
// on arrival, and auto-clears. The server already rate-limits these per zone.
let _skyTimer = null;
export function showSkyBanner(html) {
  const host = document.getElementById('output-container');
  if (!host) return;
  let el = document.getElementById('sky-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sky-banner';
    host.appendChild(el);
  }
  el.innerHTML = `<span class="sky-glyph">✈</span> ${html}`;
  // Restart the entrance animation even if a prior banner is still showing.
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(_skyTimer);
  _skyTimer = setTimeout(() => el.classList.remove('show'), 7000);
}

export function appendPre(text, cls = '') {
  const el = document.createElement('pre');
  el.className = `msg msg-${cls}`;
  el.textContent = text;
  document.getElementById('output').appendChild(el);
  scrollOutput();
}

// New room text enters in the direction of travel so a move reads as a step.
const AREA_SLIDE = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };

// Description collapse is a compact-view preference: the room prose clamps to
// a few lines with a toggle, and the choice persists across room changes.
function applyDescCollapse(el) {
  if (document.documentElement.getAttribute('data-density') !== 'compact') return;
  const desc = el.querySelector('.room-desc');
  if (!desc) return;
  const expanded = localStorage.getItem('areaDescExpanded') === '1';
  desc.classList.toggle('collapsed', !expanded);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'room-desc-toggle';
  toggle.textContent = expanded ? '− less' : '+ more';
  toggle.addEventListener('click', () => {
    const expand = desc.classList.contains('collapsed'); // collapsed → expand
    desc.classList.toggle('collapsed', !expand);
    localStorage.setItem('areaDescExpanded', expand ? '1' : '0');
    toggle.textContent = expand ? '− less' : '+ more';
  });
  desc.after(toggle);
}

export function setAreaPane(html, direction) {
  const el = document.getElementById('area-content');
  el.innerHTML = html;
  applyDescCollapse(el);
  // Only a location change (move) plays the slide transition. Silent refreshes
  // from kills, loot, look, etc. pass no direction and update in place.
  if (direction && el.animate && document.documentElement.getAttribute('data-motion') !== 'off') {
    const off = AREA_SLIDE[direction] || [0, 1];
    el.animate(
      [{ opacity: 0, transform: `translate(${off[0] * 10}px, ${off[1] * 10}px)` },
       { opacity: 1, transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease-out' }
    );
  }
  document.getElementById('area-pane').dispatchEvent(new CustomEvent('contentupdate'));
}

// Ripple the room-pane link for `action`+`target` (server `pointAt()`), telling
// the player where to click. The pane may not carry the link yet — a look can
// still be in flight behind the message that pointed — so retry briefly.
export function pointAtRoomTarget(action, target, tries = 6) {
  if (!action || !target) return;
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  const pane = document.getElementById('area-content');
  const el = pane && [...pane.querySelectorAll(`[data-action="${action}"][data-target]`)]
    .find((n) => n.dataset.target.toLowerCase() === String(target).toLowerCase());
  if (!el) {
    if (tries > 0) setTimeout(() => pointAtRoomTarget(action, target, tries - 1), 400);
    return;
  }
  el.classList.remove('point-ripple');
  void el.offsetWidth; // restart the animation if it's already been pointed at
  el.classList.add('point-ripple');
  setTimeout(() => el.classList.remove('point-ripple'), 3600);
}

export function scrollOutput() {
  const out = document.getElementById('output');
  out.scrollTop = out.scrollHeight;
}

export function updateVitals(p) {
  setBar('hp', p.hp, p.hp_max || 100);
  setBar('san', p.sanity, p.sanity_max || 100);
  setBar('hun', p.hunger, 100);
  setBar('thi', p.thirst, 100);
  setBar('sta', p.stamina, p.stamina_max || 100);
  setBar('rad', p.radiation, 100, true);
  // Radiation bar — only visible when the player is actually irradiated
  if (p.radiation !== undefined) {
    const showRad = (p.radiation || 0) > 0;
    const desktop = document.getElementById('rad-bar-wrap');
    if (desktop) desktop.style.display = showRad ? '' : 'none';
    const mobileInner = document.getElementById('rad-bar-wrap-m');
    const mobileRow = mobileInner && mobileInner.closest('.mob-bar-row');
    if (mobileRow) mobileRow.style.display = showRad ? '' : 'none';
  }
  // Combat stance chip. Stance is persistent state, so it lives in the HUD
  // rather than being re-announced in the output pane every swing — the pane
  // already prints a line every attack cycle. `normal` is the default and the
  // no-op, so it stays hidden: the chip only appears when you've actually
  // committed to something.
  if (p.combat_stance !== undefined) {
    const stance = p.combat_stance || 'normal';
    for (const id of ['stance-chip', 'stance-chip-m']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = `⚔ ${stance.toUpperCase()}`;
      el.className = `stance-chip stance-${stance}`;
      // The mobile chip sits inside its own bar row — hide the row, or an empty
      // one is left behind.
      const host = el.closest('.mob-bar-row') || el;
      host.style.display = stance === 'normal' ? 'none' : '';
    }
  }
  if (p.credits !== undefined) {
    const el = document.getElementById('header-credits-val');
    if (el) el.textContent = p.credits;
  }
  // Horniness bar — only visible when MIS is active
  if (p.mis_enabled !== undefined) {
    const show = p.mis_enabled === 1 || p.mis_enabled === true;
    for (const id of ['horny-bar-wrap', 'horny-bar-wrap-m']) {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    }
  }
  if (p.horniness !== undefined) {
    setBar('hor', p.horniness, 100);
  }
  if (p.body_temp_c !== undefined) {
    updateBodyTempHUD(p.body_temp_c);
  }
  // Player-bound custom panels track the built-in vitals in lockstep.
  refreshCustomPanels();
}

function setBar(id, val, max, inverse = false) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  const low = inverse ? pct > 60 : pct < 25;
  for (const suffix of ['', '-m']) {
    const bar = document.getElementById(`${id}-bar${suffix}`);
    const valEl = document.getElementById(`${id}-val${suffix}`);
    if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('low', low); }
    if (valEl) valEl.textContent = Math.round(val);
  }
}

// Maps dpad data-cmd abbreviations to full direction names used in exit data-target
const _DPAD_DIR = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down', in:'in', out:'out' };

export function parseZoneInfo(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const zoneName = tmp.querySelector('.zone-name')?.textContent;
  if (zoneName) {
    document.getElementById('zone-name-display').textContent = zoneName;
    const bar = document.getElementById('mob-room-name-bar');
    if (bar) bar.textContent = zoneName;
  }

  const exitLinks = tmp.querySelectorAll('.action-link.exit-link, .action-link.building-link, .action-link.room-nav-link, .action-link.door-link');
  const availDirs = new Set();
  const lockByDir = {}; // direction -> 'locked' | 'owned' (door-links only)
  for (const link of exitLinks) {
    if (!link.dataset.target) continue;
    // door-links carry "door <dir>"; plain exits carry the raw direction
    const dir = link.dataset.target.replace(/^door /, '');
    availDirs.add(dir);
    if (link.dataset.lock) lockByDir[dir] = link.dataset.lock;
  }

  // Light up dpad buttons for available exits, tinting locked/owned doors
  for (const btn of document.querySelectorAll('#mob-dpad .dpad-btn[data-cmd], #loc-dpad .dpad-btn[data-cmd]')) {
    const dir = _DPAD_DIR[btn.dataset.cmd] || btn.dataset.cmd;
    btn.classList.toggle('dpad-available', availDirs.has(dir));
    btn.classList.toggle('dpad-locked', lockByDir[dir] === 'locked');
    btn.classList.toggle('dpad-owned', lockByDir[dir] === 'owned');
  }

  // Rebuild the mobile smart action bar from the same room refresh.
  renderSmartBar();
}

export function showDevPanelButton() {
  const btn = document.getElementById('dev-panel-btn');
  if (btn) btn.style.display = '';
  const dbg = document.getElementById('debug-whisper-btn');
  if (dbg) dbg.style.display = '';
}
