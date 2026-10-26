// THE DEPOT SHELL: the counter and the bay, once, for every place you keep a vehicle.
//
// Three places sell, store and service vehicles: the truck depot (truck-depot.js), the marina
// (marina-panel.js) and the hangar (hangar-bay.js). Each one is the same two screens:
//
//   THE COUNTER, in the room pane: your vehicles as a hand of cards (vehicle-card.js), then a card
//       to buy one and a card to hire one. A card seats you in the vehicle.
//   THE BAY, a garage over the seat's whole glass while the vehicle stands in the real shed: the
//       vehicle in the middle, the jobs as a menu down the left that says what each one needs, and
//       the job's page in a column on the right.
//
// They used to draw both screens three different ways: three headers, three money formats, three
// close glyphs, three ways to confirm a sale. This file is the one way. It holds the chrome and the
// widgets every depot shares; what is in a tab (a truck's dials, a boat's swatches, an aircraft's
// colour wheel) stays in the depot's own file.
//
// ⚠ THE CLIENT COMPUTES NOTHING HERE EITHER. Every number is one the server sent. The one thing
// this file derives is that a push carries fewer credits than the one before it, which is a
// purchase, and it answers that with the purchase moment (`notePush`).
//
// ⚠ EVERY BUTTON IS STILL A VERB. A depot builds its buttons with a `data-cmd` (or `data-hold` for
// the ones you can't undo) holding the exact command a player could type; the shell never invents
// a command. The log rung is the same verbs without the cardboard.

import { holdToConfirm } from './hold-confirm.js';
import { playUi } from '../ui-sound.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';
export { esc };

// depot-shell.css ships beside this file and is fetched when the module loads, so ensureDepotStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const SHELL_CSS = await loadCss(new URL('./depot-shell.css', import.meta.url));

/** The one money format: the glyph first, thousands separated. The log prints credits this way. */
export const money = (n) => `₵${Math.round(Number(n) || 0).toLocaleString()}`;
export const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
/** A 0..1 condition's tone, off the cut-offs every depot uses. */
export const tone = (v) => (v < 0.3 ? 'bad' : v < 0.6 ? 'warn' : 'ok');

const motionOff = () => document.documentElement.dataset.motion === 'off'
  || document.body?.dataset?.motion === 'off'
  || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── The counter's head ───────────────────────────────────────────────────────
// One row: back (on a sub-screen), the place, the screens, the balance, the two view toggles and
// close. ✕ is the close glyph because ui-sound.js hears it as a cancel.
export function headHtml({ ico = '', title = '', sub = '', credits = 0, screens = null, screen = '', back = '' } = {}) {
  const fs = document.body.classList.contains('ds-fullscreen');
  const hp = document.body.classList.contains('ds-hidepanel');
  const nav = screens?.length
    ? `<nav class="ds-seg" aria-label="Screens">${screens.map(([k, label, ic]) =>
      `<button class="ds-tab${k === screen ? ' on' : ''}" data-ds-screen="${esc(k)}" role="tab" aria-selected="${k === screen}">${ic ? `<span class="ds-tab-ico" aria-hidden="true">${ic}</span>` : ''}${esc(label)}</button>`).join('')}</nav>`
    : '';
  return `<header class="ds-head">
    ${back ? `<button class="ds-x ds-back" data-ds="back" title="Back">‹ ${esc(back)}</button>` : ''}
    <div class="ds-title">${ico ? `<span class="ds-title-ico" aria-hidden="true">${ico}</span>` : ''}<b>${esc(title)}</b>${sub ? `<span class="ds-dim"> · ${esc(sub)}</span>` : ''}</div>
    ${nav}
    <b class="ds-bal" data-ds-bal="${Number(credits) || 0}">${money(credits)}</b>
    <span class="ds-viewbtns">
      <button class="ds-x${hp ? ' on' : ''}" data-ds="hidepanel" title="Hide the text log">⊟</button>
      <button class="ds-x${fs ? ' on' : ''}" data-ds="fullscreen" title="Fullscreen">⛶</button>
      <button class="ds-x" data-ds="close" title="Close" aria-label="Close">✕</button>
    </span>
  </header>`;
}

// ── The job tiles ────────────────────────────────────────────────────────────
// A tab that says what is waiting behind it: "2 due", "unsaved", "3 fitted". A tile is
// { id, ico, label, sub, tone } with tone one of ok / warn / bad / hot (hot = something unsaved).
export function jobsHtml(jobs, active, attr = 'data-ds-job') {
  return `<nav class="ds-jobs" role="tablist">${jobs.map((j) => `<button class="ds-job${j.id === active ? ' on' : ''}" ${attr}="${esc(j.id)}" role="tab" aria-selected="${j.id === active}">
      <span class="ds-job-ico" aria-hidden="true">${j.ico || ''}</span><b>${esc(j.label)}</b>${j.sub != null && j.sub !== '' ? `<span class="ds-job-sub${j.tone ? ' ' + j.tone : ''}">${esc(j.sub)}</span>` : ''}</button>`).join('')}</nav>`;
}

// ── The bay ──────────────────────────────────────────────────────────────────
// The overlay on a seat's glass. `mountBay` keeps one element per depot in the seat's host and
// hands it back; the depot fills it with `bayHtml` (open) or `bayChipHtml` (folded).
export function mountBay(host, id, handlers = {}) {
  let el = document.getElementById(id);
  if (!el || el.parentElement !== host) {
    el?.remove();
    el = document.createElement('div');
    el.id = id;
    for (const [ev, fn] of Object.entries(handlers)) el.addEventListener(ev, fn);
    host.appendChild(el);
    bayWheel(el);
    keepPageScroll(el);
  }
  return el;
}
// ── ⚠ ONLY THE PAGE SCROLLS ──────────────────────────────────────────────────
// The wheel over the glass is the chase camera's dolly. The bay used to float over the vehicle and
// so never scrolled at all: it scaled itself down to fit instead, and a long page (the racer's
// sixteen fitting rows) came out at half size. Now the bay is a garage that fills the glass, with
// the vehicle in a clear stage in the middle, and the page is its own column at the side. A wheel
// over that column scrolls it, if it has anywhere to go; a wheel anywhere else on the bay (the
// head, the rail, a page that fits) goes on to whatever is under it, which is the seat's view. The
// stage takes no pointer at all, so a drag or a wheel over the vehicle reaches the glass directly.
// Nothing in the page scales to fit any more: text in a garage is read at garage size.
function bayWheel(el) {
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.defaultPrevented) return;
    // The page column, or on a phone the whole sheet: whichever scroller is under the pointer.
    for (let n = e.target; n && n !== el; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return;
    }
    e.preventDefault(); e.stopPropagation();
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => !el.contains(n));
    under?.dispatchEvent(new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true,
    }));
  }, { passive: false });
}
// A depot deals the whole bay again after every click, which would put the page back at its top
// each time a part is picked. So the page's scroll is kept across a redraw, for as long as the same
// job tile is lit; a new tab starts at the top.
function keepPageScroll(el) {
  let kept = { job: null, top: 0 };
  const jobOf = () => el.querySelector('.ds-job.on')?.textContent || '';
  el.addEventListener('scroll', (e) => {
    if (e.target.classList?.contains('ds-bay-body')) kept = { job: jobOf(), top: e.target.scrollTop };
  }, true);
  if (typeof MutationObserver !== 'function') return;
  new MutationObserver(() => {
    const page = el.querySelector('.ds-bay-body');
    if (page && kept.top && jobOf() === kept.job) page.scrollTop = kept.top;
  }).observe(el, { childList: true });
}
/** Open or folded. `extra` is the depot's own scope class, for the tabs' styles. */
export function setBayOpen(el, open, extra = '') { el.className = `ds-root ds-bay ${open ? 'open' : 'folded'}${extra ? ' ' + extra : ''}`; }

/**
 * The open bay: a garage over the whole glass, NFS-style. The vehicle stands in a clear stage in
 * the middle; the jobs are a menu down the left; the page is a column on the right.
 *
 *   head     the place, the balance and `actions` (the way out last, as `leaveHtml` builds it)
 *   stage    clear, with `name` (the vehicle's, when `title` is the place's) cut into its floor
 *   rail     `jobs` (the tiles, drawn as a menu here), `notes` (a hire's clock, the pin) and `side`
 *            (what the page wants beside it: the figures a part would change)
 *   page     `body`, which scrolls if it has to, and `till` pinned under it (the bill and the key
 *            that pays it), so the price is in view however long the list
 *   foot     one line, with the camera's keys
 *
 * On a narrow glass the stage goes and the garage becomes one sheet up from the bottom (the CSS
 * container queries on `.ds-gx`).
 */
export function bayHtml({ ico = '⚙', title = '', sub = '', name = '', credits = 0, actions = '', notes = '', jobs = '', side = '', body = '', till = '', foot = '', toast = null } = {}) {
  return `<div class="ds-gx">
    <header class="ds-bay-head">
      <div class="ds-title"><span class="ds-title-ico" aria-hidden="true">${ico}</span><b>${esc(title)}</b>${sub ? `<span class="ds-dim"> · ${esc(sub)}</span>` : ''}</div>
      <b class="ds-bal" data-ds-bal="${Number(credits) || 0}">${money(credits)}</b>
      ${actions}
    </header>
    <aside class="ds-gx-rail">${jobs}${notes}${side ? `<div class="ds-gx-side">${side}</div>` : ''}</aside>
    <div class="ds-gx-stage" aria-hidden="true"><i class="ds-gx-corner tl"></i><i class="ds-gx-corner tr"></i><i class="ds-gx-corner bl"></i><i class="ds-gx-corner br"></i><span class="ds-gx-name">${esc(name || title)}</span></div>
    <section class="ds-gx-page">
      <div class="ds-bay-body">${body}</div>
      ${till ? `<div class="ds-gx-till">${till}</div>` : ''}
      ${toastHtml(toast)}
    </section>
    <footer class="ds-bay-foot"><span class="ds-dim">${foot}</span><span class="ds-gx-keys"><kbd>drag</kbd> turn the camera</span></footer>
  </div>`;
}

/**
 * THE PARTS MENU, the way a tuning garage lays one out: a row of groups, the slots of the open group
 * as a list that says what each has now, and the open slot's options as cards under it. Only one
 * slot is open at a time, so the list stays short however many parts there are.
 *
 *   groups   [{ id, label }], with `group` the open one (a click is `on.group(id)` in shellClick)
 *   slots    [{ id, label, value, changed, tip }] of the open group, with `slot` the open one
 *            (`on.slot(id)`); `changed` marks a slot the working kit has moved off what is fitted
 *   options  the open slot's [{ label, price, blurb, on, mine, dot, attrs }]: `on` is the working
 *            pick, `mine` what is fitted, `dot` a CSS colour, `attrs` the depot's own click hook
 *            (`data-kit="engine:2"`), since what a pick does is the depot's business
 */
export function partsHtml({ groups = [], group = '', slots = [], slot = '', options = [] } = {}) {
  const opts = `<div class="ds-popts">${options.map((o) => `<button class="ds-popt${o.on ? ' on' : ''}${o.mine ? ' mine' : ''}" type="button" ${o.attrs || ''}${o.blurb ? ` title="${esc(o.blurb)}"` : ''}>
      <span class="ds-popt-top">${o.dot ? `<i class="ds-popt-dot" style="background:${esc(o.dot)};box-shadow:0 0 8px ${esc(o.dot)}"></i>` : ''}<b>${esc(o.label)}</b></span>
      <span class="ds-popt-price">${esc(o.price || '')}${o.mine ? '<span class="ds-popt-mine">✓ fitted</span>' : ''}</span>
    </button>`).join('')}</div>`;
  const open = slots.find((s) => s.id === slot);
  return `${groups.length > 1 ? `<nav class="ds-pgroups">${groups.map((g) => `<button class="ds-pgroup${g.id === group ? ' on' : ''}" type="button" data-ds-group="${esc(g.id)}">${esc(g.label)}</button>`).join('')}</nav>` : ''}
    <div class="ds-parts">${slots.map((s) => `<button class="ds-part${s.id === slot ? ' on' : ''}${s.changed ? ' changed' : ''}" type="button" data-ds-slot="${esc(s.id)}" aria-expanded="${s.id === slot}">
        <span class="ds-part-l">${esc(s.label)}</span><span class="ds-part-v">${esc(s.value)}</span></button>
      ${s.id === slot ? `${s.tip ? `<p class="ds-part-tip">${esc(s.tip)}</p>` : ''}${opts}` : ''}`).join('')}</div>
    ${open ? '' : opts}`;
}
/** The bay's way out: folds it and hands the seat back. Always the last key in the head. */
export function leaveHtml(label) {
  return `<button class="ds-btn primary ds-leave" data-ds="bay-fold" title="Fold the bay away">${esc(label)} ▸</button>`;
}
/** Folded, the bay is one chip in the corner that says where you are. */
export function bayChipHtml(label) {
  return `<button class="ds-chip" data-ds="bay-open" title="Open the bay">${esc(label)}</button>`;
}

export function toastHtml(t) {
  return t ? `<div class="ds-toast${t.kind ? ' ' + esc(t.kind) : ''}" aria-hidden="true">${esc(t.text)}</div>` : '';
}

// ── The widgets ──────────────────────────────────────────────────────────────

/** A labelled bar with its percentage. `v` is 0..1. */
export function meterHtml(label, v, { cls = '' } = {}) {
  const p = Math.round(clamp01(v) * 100);
  return `<div class="ds-meter${cls ? ' ' + cls : ''}"><span class="ds-meter-l">${esc(label)}</span><span class="ds-meter-t"><i class="${tone(v)}" style="width:${p}%"></i></span><span class="ds-meter-v">${p}%</span></div>`;
}

/**
 * Performance bars, NFS-style: what you have, and what you would have. `rows` is [[key, label]],
 * values are 0..1. With `prev`, the part of a bar that a change adds is drawn green and the part it
 * takes away is drawn as a red ghost, so a kit's effect is read before it is bought.
 */
export function statsHtml(rows, now, prev = null) {
  if (!now) return '';
  return `<div class="ds-stats">${rows.map(([k, label]) => {
    const v = clamp01(now[k]), p = prev ? clamp01(prev[k]) : v;
    const lo = Math.min(v, p), d = Math.round((v - p) * 100);
    return `<div class="ds-stat"><span class="ds-stat-l">${esc(label)}</span><span class="ds-stat-t">
        <i class="base" style="width:${lo * 100}%"></i>
        ${v > p ? `<i class="gain" style="left:${p * 100}%;width:${(v - p) * 100}%"></i>` : ''}
        ${v < p ? `<i class="loss" style="left:${v * 100}%;width:${(p - v) * 100}%"></i>` : ''}
      </span><span class="ds-stat-d${d > 0 ? ' up' : d < 0 ? ' down' : ''}">${d > 0 ? '+' + d : d < 0 ? d : ''}</span></div>`;
  }).join('')}</div>`;
}

/**
 * The servicing docket: one row per wearing part, each with its life bar and the price to put it
 * right. `items` is the server's { id, label, band ('fresh'|'due'|'over'), bandLabel, life, price,
 * desc }; `cmdFor(item)` is the verb that services it.
 */
export function serviceListHtml(items, cmdFor) {
  return `<div class="ds-svc">${(items || []).map((i) => `<div class="ds-svc-row ${esc(i.band)}">
      <div class="ds-svc-main"><b>${esc(i.label)}</b> <span class="ds-dim">· ${esc(i.bandLabel)}</span>
        <span class="ds-svc-bar"><i class="${i.band === 'fresh' ? 'ok' : i.band === 'due' ? 'warn' : 'bad'}" style="width:${Math.round(clamp01(i.life) * 100)}%"></i></span>
        ${i.desc ? `<div class="ds-dim ds-small">${esc(i.desc)}</div>` : ''}</div>
      <button class="ds-btn" data-cmd="${esc(cmdFor(i))}" ${i.life >= 0.995 ? 'disabled title="Just done"' : ''}>${money(i.price)}</button>
    </div>`).join('')}</div>`;
}

/** A button. `cmd` is the verb it sends; `hold` makes it a hold-to-confirm (see armHolds). */
export function btnHtml(label, { cmd = '', hold = '', ico = '', cls = '', attrs = '', disabled = false, why = '' } = {}) {
  const a = cmd ? `data-cmd="${esc(cmd)}"` : hold ? `data-hold="${esc(hold)}"` : '';
  return `<button class="ds-btn${cls ? ' ' + cls : ''}" ${a} ${attrs}${disabled ? ' disabled' : ''}${why ? ` title="${esc(why)}"` : ''}>${ico ? `<span class="ds-btn-ico" aria-hidden="true">${ico}</span>` : ''}${esc(label)}</button>`;
}

/**
 * THE WAY INTO WHAT YOU JUST BOUGHT. A purchase or a hire lands on the hand with this over it: what
 * she is, where she is, and one key that seats you, so getting from the till to the road is a click
 * and not a card on another screen or a verb in the log. The server says which vehicle (`fresh` on
 * the payload, server/engine/fresh-vehicle.js); the depot passes the same verb its card sends, or a
 * hold when the card's way in costs money (the marina's crane). It goes when the hand is dealt
 * without it.
 */
export function readyHtml({ title = '', sub = '', label = 'Drive it', cmd = '', hold = '', ico = '⏵', attrs = '' } = {}) {
  return `<div class="ds-ready" role="status">
    <span class="ds-ready-txt"><b>${esc(title)}</b>${sub ? `<span class="ds-dim ds-small">${esc(sub)}</span>` : ''}</span>
    ${btnHtml(label, { cmd, hold, ico, cls: 'primary ds-ready-go', attrs })}
  </div>`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

/**
 * Turn every `[data-hold]` under `root` into a hold-to-confirm that sends its verb. The things you
 * can't undo (selling, handing a hire back, a tow bill) are held, not clicked, the same as the
 * confirm windows (confirm.js holdToConfirm). Call after every render.
 */
export function armHolds(root, send) {
  for (const b of root.querySelectorAll('[data-hold]:not(.confirm-hold)')) {
    if (b.disabled) continue;
    holdToConfirm(b, () => { noteAct(b); send(b.dataset.hold); });
  }
}

/**
 * The shell's own keys: the two view toggles, close, back, and folding or opening the bay.
 * Returns true when it handled the click. `on` holds the depot's answers to close / back / fold /
 * open / screen / group / slot; the view toggles need nothing from the depot.
 */
export function shellClick(e, on = {}) {
  const t = e.target.closest?.('[data-ds],[data-ds-screen],[data-ds-group],[data-ds-slot]');
  if (!t || t.disabled) return false;
  if (t.dataset.dsScreen) { on.screen?.(t.dataset.dsScreen); return true; }
  // The parts menu's groups and slots (partsHtml).
  if (t.dataset.dsGroup) { on.group?.(t.dataset.dsGroup); return !!on.group; }
  if (t.dataset.dsSlot) { on.slot?.(t.dataset.dsSlot); return !!on.slot; }
  const act = t.dataset.ds;
  if (act === 'hidepanel' || act === 'fullscreen') {
    const cls = `ds-${act}`, other = act === 'fullscreen' ? 'ds-hidepanel' : 'ds-fullscreen';
    document.body.classList.remove(other);
    document.body.classList.toggle(cls);
    const root = t.closest('.ds-root');
    root?.querySelector('[data-ds="fullscreen"]')?.classList.toggle('on', document.body.classList.contains('ds-fullscreen'));
    root?.querySelector('[data-ds="hidepanel"]')?.classList.toggle('on', document.body.classList.contains('ds-hidepanel'));
    return true;
  }
  const fn = { close: on.close, back: on.back, 'bay-fold': on.fold, 'bay-open': on.open }[act];
  if (fn) { fn(); return true; }
  return false;
}
/** Leaving a counter drops the immersive layout, or the room look that follows has no log. */
export function clearViewModes() { document.body.classList.remove('ds-fullscreen', 'ds-hidepanel'); }

// ── The purchase moment ──────────────────────────────────────────────────────
// A garage answers a purchase: the till, the price stamped over the work, the balance counting
// down. Nothing here knows what was bought. The depot calls `noteAct` with the button that was
// pressed (the click handler does it for every data-cmd), and `notePush` with each push's credits;
// when a push arrives with fewer credits than the last and a button was pressed in the last few
// seconds, that button's label is what was bought.
let lastAct = null;     // { label, at }
export function noteAct(btn) {
  const label = (btn?.querySelector?.('.hold-label')?.textContent || btn?.textContent || '').replace(/\s+/g, ' ').trim();
  lastAct = label ? { label, at: performance.now() } : null;
}

/**
 * Call with the root the panel just drew and the credits before and after the push. Spends trigger
 * the moment; a refund or no change just sets the balance. Returns true when it celebrated.
 */
export function notePush(root, before, after) {
  const bal = root?.querySelector?.('[data-ds-bal]');
  const from = Number(before), to = Number(after);
  if (!bal || !Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  tickCredits(bal, from, to);
  if (to > from) return false;
  const act = lastAct && performance.now() - lastAct.at < 8000 ? lastAct : null;
  lastAct = null;
  celebrate(root, { amount: from - to, label: act ? act.label.replace(/\s*·\s*₵[\d,]+.*$/, '') : '' });
  return true;
}

/** The balance counts from what it was to what it is, the way a garage menu's does. */
export function tickCredits(el, from, to) {
  if (motionOff()) { el.textContent = money(to); return; }
  const t0 = performance.now(), ms = Math.min(900, 300 + Math.abs(to - from) * 0.4);
  el.classList.add(to < from ? 'spend' : 'earn');
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = money(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
    else setTimeout(() => el.classList.remove('spend', 'earn'), 400);
  };
  requestAnimationFrame(step);
}

/** The stamp over the work and the till. `label` may be empty: the price alone is still news. */
export function celebrate(root, { amount = 0, label = '' } = {}) {
  if (!root) return;
  playUi('ui-purchase');
  root.querySelector(':scope > .ds-stamp')?.remove();
  const s = document.createElement('div');
  s.className = 'ds-stamp';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `${label ? `<b>${esc(label)}</b>` : ''}<span>−${money(amount)}</span>`;
  root.appendChild(s);
  root.classList.remove('ds-sheen');
  void root.offsetWidth;   // restart the sweep if two purchases land close together
  root.classList.add('ds-sheen');
  setTimeout(() => { s.remove(); root.classList.remove('ds-sheen'); }, motionOff() ? 1600 : 2200);
}

// ── The styles ───────────────────────────────────────────────────────────────
// The hangar's palette, which the depot already borrowed: one accent from the theme, three surface
// tiers mixed from it, two bevels that read on a light theme and a dark one. A depot's own tab
// content keeps its own class names and reads these tokens.
export function ensureDepotStyles() {
  if (document.getElementById('ds-styles')) return;
  const s = document.createElement('style');
  s.id = 'ds-styles';
  s.textContent = SHELL_CSS;
  document.head.appendChild(s);
}
