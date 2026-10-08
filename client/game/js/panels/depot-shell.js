// THE DEPOT SHELL: the counter and the bay, once, for every place you keep a vehicle.
//
// Three places sell, store and service vehicles: the truck depot (truck-depot.js), the marina
// (marina-panel.js) and the hangar (hangar-bay.js). Each one is the same two screens:
//
//   THE COUNTER, in the room pane: your vehicles as a hand of cards (vehicle-card.js), then a card
//       to buy one and a card to hire one. A card seats you in the vehicle.
//   THE BAY, an overlay on the seat's own glass while the vehicle stands in the real shed: the
//       jobs as a row of tiles that say what each one needs, and the tile's page under them.
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

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
  }
  return el;
}
/** Open or folded. `extra` is the depot's own scope class, for the tabs' styles. */
export function setBayOpen(el, open, extra = '') { el.className = `ds-root ds-bay ${open ? 'open' : 'folded'}${extra ? ' ' + extra : ''}`; }

/**
 * The open bay. `actions` is the head's buttons (the way out first, as `leaveHtml` builds it);
 * `notes` sits under the head (a hire's clock, the pin); `jobs` is the tile row; `foot` is one line.
 */
export function bayHtml({ ico = '⚙', title = '', sub = '', credits = 0, actions = '', notes = '', jobs = '', body = '', foot = '', toast = null } = {}) {
  return `<header class="ds-bay-head">
      <div class="ds-title"><span class="ds-title-ico" aria-hidden="true">${ico}</span><b>${esc(title)}</b>${sub ? `<span class="ds-dim"> · ${esc(sub)}</span>` : ''}</div>
      <b class="ds-bal" data-ds-bal="${Number(credits) || 0}">${money(credits)}</b>
      ${actions}
    </header>
    ${notes}
    ${jobs}
    <div class="ds-bay-body">${body}</div>
    ${toastHtml(toast)}
    ${foot ? `<div class="ds-bay-foot ds-dim">${foot}</div>` : ''}`;
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
 * open; the view toggles need nothing from the depot.
 */
export function shellClick(e, on = {}) {
  const t = e.target.closest?.('[data-ds],[data-ds-screen]');
  if (!t || t.disabled) return false;
  if (t.dataset.dsScreen) { on.screen?.(t.dataset.dsScreen); return true; }
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
  s.textContent = `
  .ds-root{--ds-accent:var(--accent,#d8892e);
    --ds-surf:color-mix(in srgb, var(--ds-accent) 18%, var(--bg2));
    --ds-surf-lo:color-mix(in srgb, var(--ds-accent) 6%, var(--bg2));
    --ds-surf-mid:color-mix(in srgb, var(--ds-accent) 12%, var(--bg2));
    --ds-bevel-hi:rgba(255,255,255,.5); --ds-bevel-lo:rgba(0,0,0,.45);
    --ds-fg:var(--text-bright,var(--text,#eafffb));
    --ds-fg-dim:var(--text-dim,#9db5c6);
    --ds-ok:#5c8f6a; --ds-warn:#e8c07a; --ds-bad:#d2685c; --ds-gain:#6fcf83;
    white-space:normal;color:var(--ds-fg);font-family:'Courier New',monospace;line-height:1.45}
  .ds-dim{color:var(--ds-fg-dim)}
  .ds-small{font-size:11.5px}
  /* THE COUNTER: a moulded chassis that fills the pane; only its body scrolls. */
  #area-pane:has(> #area-content > .ds-counter){overflow:hidden}
  #area-content:has(> .ds-counter){height:100%;min-height:0;display:flex;flex-direction:column}
  .ds-counter{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;font-size:14px;
    background:linear-gradient(175deg,color-mix(in srgb, var(--border) 55%, var(--bg3)) 0%,var(--bg3) 8%,var(--bg2) 50%),
      radial-gradient(140% 100% at 50% 0%,color-mix(in srgb, var(--border) 40%, var(--bg3)),var(--bg) 75%);
    border:1px solid color-mix(in srgb, var(--ds-accent) 22%, var(--border));border-radius:10px;overflow:hidden;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(0,0,0,.3),0 14px 34px rgba(0,0,0,.5)}
  /* Brushed-plastic grain over the chassis, under every real surface. */
  .ds-counter::before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;
    background-image:repeating-linear-gradient(35deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px),
      repeating-linear-gradient(-55deg,rgba(0,0,0,.03) 0 1px,transparent 1px 4px)}
  .ds-counter > *{position:relative;z-index:1}
  .ds-counter > .ds-toast,.ds-counter > .ds-stamp{position:absolute}
  .ds-head{display:flex;align-items:center;gap:10px;padding:0 12px;height:46px;flex:0 0 auto;
    background:color-mix(in srgb, var(--ds-surf) 82%, transparent);
    -webkit-backdrop-filter:blur(11px) saturate(1.15);backdrop-filter:blur(11px) saturate(1.15);
    border-bottom:1px solid color-mix(in srgb, var(--ds-accent) 26%, transparent);
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 2px 8px rgba(0,0,0,.14)}
  .ds-title{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ds-title b{letter-spacing:1.2px;text-transform:uppercase;text-shadow:0 0 6px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  .ds-title-ico{margin-right:6px;opacity:.85}
  .ds-bal{margin-left:auto;flex:0 0 auto;white-space:nowrap;letter-spacing:1px;font-variant-numeric:tabular-nums;
    transition:color .3s;text-shadow:0 0 5px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  .ds-bal.spend{color:var(--ds-warn)}.ds-bal.earn{color:var(--ds-gain)}
  .ds-viewbtns{display:flex;gap:5px;flex:0 0 auto}
  .ds-x{font-family:inherit;font-size:14px;line-height:1;cursor:pointer;padding:6px 9px;color:var(--ds-fg-dim);
    background:linear-gradient(165deg,var(--ds-surf),var(--ds-surf-lo));
    border:1px solid color-mix(in srgb, var(--ds-accent) 28%, transparent);border-radius:6px;
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi);transition:filter .12s,box-shadow .12s,color .12s,border-color .12s}
  .ds-x:hover,.ds-x.on{color:var(--ds-fg);border-color:var(--ds-accent);
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 0 10px color-mix(in srgb, var(--ds-accent) 28%, transparent)}
  .ds-back{font-size:12px;letter-spacing:.5px}
  .ds-seg{display:flex;gap:3px;flex:0 0 auto;padding:3px;border-radius:8px;
    background:var(--ds-surf-lo);box-shadow:inset 0 2px 5px var(--ds-bevel-lo)}
  .ds-tab{display:flex;align-items:center;gap:5px;font-family:inherit;font-size:12px;letter-spacing:.6px;text-transform:uppercase;
    cursor:pointer;padding:5px 10px;border:0;border-radius:6px;background:transparent;color:var(--ds-fg-dim);white-space:nowrap}
  .ds-tab:hover{color:var(--ds-fg);background:color-mix(in srgb, var(--ds-accent) 10%, transparent)}
  .ds-tab.on{color:var(--ds-fg);background:linear-gradient(165deg,var(--ds-surf),var(--ds-surf-lo));
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 0 10px color-mix(in srgb, var(--ds-accent) 25%, transparent)}
  .ds-tab-ico{opacity:.75}
  .ds-body{flex:1;min-height:0;overflow:auto;padding:10px 12px}
  .ds-hint{color:var(--ds-fg-dim);font-size:13px;margin:0 0 8px;max-width:60ch}
  .ds-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px 12px;font-size:11.5px;
    color:var(--ds-fg-dim);border-top:1px solid color-mix(in srgb, var(--ds-accent) 20%, transparent);
    background:color-mix(in srgb, var(--ds-surf-lo) 80%, transparent)}
  /* A raised panel inside either screen. */
  .ds-panel{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:9px;margin-bottom:8px;
    background:linear-gradient(165deg,var(--ds-surf),var(--ds-surf-lo));
    border:1px solid color-mix(in srgb, var(--ds-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),inset 0 -2px 3px var(--ds-bevel-lo),0 2px 5px rgba(0,0,0,.2)}
  .ds-panel-head{display:flex;align-items:baseline;gap:8px;justify-content:space-between}
  .ds-panel-head b{letter-spacing:.5px}
  /* THE KEY: a raised accent-tinted cap that presses in. */
  .ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:11.5px;font-weight:bold;
    letter-spacing:.5px;text-transform:uppercase;cursor:pointer;padding:7px 11px;border-radius:8px;color:var(--ds-fg);white-space:nowrap;
    border:1px solid color-mix(in srgb, var(--ds-accent) 38%, transparent);
    background:linear-gradient(165deg,var(--ds-surf),var(--ds-surf-lo));
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),inset 0 -2px 3px var(--ds-bevel-lo),0 2px 4px rgba(0,0,0,.2);
    transition:filter .12s,box-shadow .12s,border-color .12s,transform .06s}
  .ds-btn:hover:not(:disabled){filter:brightness(1.1);border-color:var(--ds-accent);
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 0 10px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  .ds-btn:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 6px var(--ds-bevel-lo)}
  .ds-btn:disabled{opacity:.4;cursor:default;filter:grayscale(.5)}
  .ds-btn.primary{border-color:var(--ds-accent);
    background:linear-gradient(165deg,color-mix(in srgb, var(--ds-accent) 34%, var(--bg2)),color-mix(in srgb, var(--ds-accent) 12%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 0 12px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  .ds-btn.ghost{background:transparent;box-shadow:none;color:var(--ds-fg-dim)}
  .ds-btn.danger.confirm-hold .hold-fill{background:color-mix(in srgb, var(--ds-bad) 55%, transparent)}
  .ds-acts{display:flex;flex-wrap:wrap;gap:6px}
  /* THE JOB TILES: icon, name, and the one line that says what is waiting. */
  .ds-jobs{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:4px;flex:0 0 auto}
  .ds-job{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;text-align:left;font-family:inherit;cursor:pointer;
    padding:5px 8px 6px;border-radius:8px;color:var(--ds-fg-dim);
    background:linear-gradient(165deg,var(--ds-surf-mid),var(--ds-surf-lo));
    border:1px solid color-mix(in srgb, var(--ds-accent) 20%, transparent);
    box-shadow:inset 0 1px 0 color-mix(in srgb, var(--ds-bevel-hi) 50%, transparent);transition:filter .12s,border-color .12s,box-shadow .12s}
  .ds-job:hover{filter:brightness(1.08);color:var(--ds-fg)}
  .ds-job.on{color:var(--ds-fg);border-color:var(--ds-accent);
    background:linear-gradient(165deg,color-mix(in srgb, var(--ds-accent) 26%, var(--bg2)),var(--ds-surf-lo));
    box-shadow:inset 0 1px 0 var(--ds-bevel-hi),0 0 12px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  .ds-job-ico{font-size:14px;line-height:1.1}
  .ds-job b{font-size:11px;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .ds-job-sub{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.85}
  .ds-job-sub.ok{color:var(--ds-gain)}.ds-job-sub.warn{color:var(--ds-warn)}.ds-job-sub.bad{color:var(--ds-bad)}
  .ds-job-sub.hot{color:var(--ds-accent)}
  /* THE BAY: docked right on the glass, under the seat's chrome, above its dash. */
  .ds-bay{position:absolute;z-index:40;right:10px;top:46px;font-size:13px}
  .ds-bay.open{bottom:12%;width:min(620px,58%);display:flex;flex-direction:column;gap:6px;padding:8px;overflow:hidden;
    background:color-mix(in srgb, var(--bg2) 86%, transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    border:1px solid color-mix(in srgb, var(--ds-accent) 36%, var(--border));border-radius:10px;
    box-shadow:0 12px 30px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);animation:dsBayIn .22s ease-out}
  @keyframes dsBayIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
  .ds-bay.folded{right:auto;left:10px}
  /* Big screen is the view and nothing else (bigscreen.js); the bay comes back with the chrome. */
  body.bigscreen .ds-bay{display:none!important}
  .ds-bay-head{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .ds-bay-head .ds-title{flex:1 1 auto}
  .ds-bay-head .ds-bal{margin-left:0}
  /* ⚠ THE PAGE KEEPS ITS FLOOR. Nine tiles in two rows on a short glass took every pixel and the
     page under them measured zero; the page holds a minimum and the bay scrolls as a whole past it. */
  .ds-bay.open{overflow-y:auto}
  .ds-bay-body{flex:1 1 auto;min-height:140px;overflow:auto;padding-right:2px;scrollbar-width:thin}
  .ds-bay-foot{flex:0 0 auto;font-size:11px;text-align:center}
  .ds-note{flex:0 0 auto;font-size:11.5px;padding:4px 8px;border-radius:6px;background:var(--ds-surf-lo);
    border:1px solid color-mix(in srgb, var(--ds-accent) 40%, transparent)}
  .ds-note.hire{border-color:color-mix(in srgb, #5aa58c 60%, transparent)}
  .ds-chip{font-family:inherit;font-size:12px;letter-spacing:.8px;cursor:pointer;padding:6px 11px;border-radius:7px;color:var(--ds-fg);
    background:color-mix(in srgb, var(--bg2) 80%, transparent);border:1px solid var(--ds-accent);
    box-shadow:0 0 10px color-mix(in srgb, var(--ds-accent) 30%, transparent)}
  /* Bars. */
  .ds-meter{display:grid;grid-template-columns:58px 1fr 40px;align-items:center;gap:8px;font-size:12px}
  .ds-meter-l{color:var(--ds-fg-dim);text-transform:uppercase;font-size:10.5px;letter-spacing:.8px}
  .ds-meter-t,.ds-svc-bar,.ds-stat-t{position:relative;display:block;height:6px;border-radius:4px;overflow:hidden;background:var(--ds-surf-lo);
    box-shadow:inset 0 1px 2px var(--ds-bevel-lo),inset 0 0 0 1px var(--border)}
  .ds-meter-t i,.ds-svc-bar i{display:block;height:100%;background:var(--ds-ok)}
  .ds-meter-v{text-align:right;font-variant-numeric:tabular-nums}
  .ds-root i.ok{background:var(--ds-ok)} .ds-root i.warn{background:var(--ds-warn)} .ds-root i.bad{background:var(--ds-bad)}
  .ds-stats{display:flex;flex-direction:column;gap:3px;margin:2px 0}
  .ds-stat{display:grid;grid-template-columns:64px 1fr 30px;align-items:center;gap:7px;font-size:10px;letter-spacing:.8px;
    text-transform:uppercase;color:var(--ds-fg-dim)}
  .ds-stat-t i{position:absolute;top:0;bottom:0;left:0}
  .ds-stat-t i.base{background:var(--ds-accent);box-shadow:0 0 7px color-mix(in srgb, var(--ds-accent) 60%, transparent)}
  .ds-stat-t i.gain{background:var(--ds-gain);animation:dsGain 1.2s ease-in-out infinite alternate}
  .ds-stat-t i.loss{background:repeating-linear-gradient(135deg,color-mix(in srgb, var(--ds-bad) 70%, transparent) 0 3px,transparent 3px 6px)}
  @keyframes dsGain{from{opacity:.65}to{opacity:1}}
  .ds-stat-d{text-align:right;font-variant-numeric:tabular-nums}
  .ds-stat-d.up{color:var(--ds-gain)}.ds-stat-d.down{color:var(--ds-bad)}
  .ds-svc-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid color-mix(in srgb, var(--border) 60%, transparent)}
  .ds-svc-row:last-child{border-bottom:0}
  .ds-svc-main{flex:1;min-width:0}
  .ds-svc-bar{margin:3px 0 1px}
  .ds-svc-row.over b{color:#f0a097}
  /* The toast: one line of news, centred low, gone in five seconds. */
  .ds-toast{position:absolute;left:50%;bottom:44px;z-index:6;max-width:min(86%,64ch);transform:translateX(-50%);pointer-events:none;
    text-align:center;font:700 12.5px/1.4 'Courier New',monospace;letter-spacing:1px;color:var(--ds-fg);padding:9px 16px;border-radius:8px;
    background:color-mix(in srgb, var(--ds-accent) 26%, rgba(6,12,18,.86));border:1px solid var(--ds-accent);
    box-shadow:0 0 18px color-mix(in srgb, var(--ds-accent) 40%, transparent);animation:dsToast 5.2s ease-out forwards}
  .ds-toast.good{border-color:var(--ds-gain);background:color-mix(in srgb, var(--ds-gain) 22%, rgba(6,12,18,.86))}
  @keyframes dsToast{0%{opacity:0;transform:translate(-50%,10px)}7%,86%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}
  /* THE PURCHASE MOMENT: a sweep of light across the panel and the price stamped over the work. */
  .ds-sheen::after{content:'';position:absolute;inset:0;z-index:30;pointer-events:none;border-radius:inherit;
    background:linear-gradient(105deg,transparent 30%,color-mix(in srgb, var(--ds-accent) 35%, rgba(255,255,255,.35)) 48%,transparent 66%);
    background-size:250% 100%;animation:dsSheen .9s ease-out forwards}
  @keyframes dsSheen{from{background-position:120% 0}to{background-position:-60% 0}}
  .ds-stamp{position:absolute;left:50%;top:42%;z-index:31;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;
    padding:10px 18px;border-radius:10px;transform:translate(-50%,-50%) rotate(-4deg);
    background:color-mix(in srgb, var(--ds-accent) 30%, rgba(6,10,14,.9));border:2px solid var(--ds-accent);
    box-shadow:0 0 28px color-mix(in srgb, var(--ds-accent) 55%, transparent),inset 0 1px 0 var(--ds-bevel-hi);
    animation:dsStamp 2.2s cubic-bezier(.2,1.4,.4,1) forwards}
  .ds-stamp b{font-size:12px;letter-spacing:2px;text-transform:uppercase;max-width:32ch;text-align:center}
  .ds-stamp span{font-size:22px;font-weight:bold;letter-spacing:1px;color:var(--ds-warn);text-shadow:0 0 10px rgba(0,0,0,.6)}
  @keyframes dsStamp{0%{opacity:0;transform:translate(-50%,-50%) rotate(-4deg) scale(1.6)}
    12%{opacity:1;transform:translate(-50%,-50%) rotate(-4deg) scale(1)}
    75%{opacity:1;transform:translate(-50%,-62%) rotate(-4deg) scale(1)}
    100%{opacity:0;transform:translate(-50%,-80%) rotate(-4deg) scale(.96)}}
  [data-motion="off"] .ds-bay.open,[data-motion="off"] .ds-stat-t i.gain{animation:none}
  [data-motion="off"] .ds-sheen::after{display:none}
  [data-motion="off"] .ds-stamp{animation:dsStampFade 1.6s linear forwards;transform:translate(-50%,-50%)}
  @keyframes dsStampFade{0%,85%{opacity:1}100%{opacity:0}}
  @media (prefers-reduced-motion:reduce){
    .ds-bay.open,.ds-stat-t i.gain{animation:none}
    .ds-sheen::after{display:none}
    .ds-stamp{animation:dsStampFade 1.6s linear forwards;transform:translate(-50%,-50%)}
    .ds-toast{animation:dsToastFade 5.2s linear forwards}
    @keyframes dsToastFade{0%,90%{opacity:1}100%{opacity:0}}
  }
  /* ⚠ ON A PHONE THE HEAD TAKES TWO ROWS, ON PURPOSE. The title, three screens, the balance and three
     buttons stop fitting on one line at 720px. The title gets a basis (not auto, or flex-wrap breaks
     the line before shrinking anything and the buttons get a row of their own), the region goes
     (it is on the sign outside), and the screens take a full-width row and shrink rather than
     scroll, because two pixels of overflow reads as a broken last tab. */
  /* A short glass gets one row of tiles that swipes sideways, so the page keeps the height. */
  @media (max-height:640px){
    .ds-jobs{grid-auto-flow:column;grid-auto-columns:minmax(84px,1fr);grid-template-columns:none;overflow-x:auto;scrollbar-width:none}
    .ds-jobs::-webkit-scrollbar{display:none}
  }
  @media (max-width:720px){
    .ds-bay.open{left:8px;right:8px;width:auto;bottom:38%}
    .ds-head{height:auto;min-height:44px;flex-wrap:wrap;padding:7px 10px;gap:6px 10px}
    .ds-head .ds-title{flex:1 1 110px}
    .ds-head .ds-title .ds-dim{display:none}
    .ds-title b{font-size:13px;letter-spacing:1px}
    .ds-bal{font-size:13px}
    .ds-head .ds-seg{order:3;flex:1 0 100%}
    .ds-tab{display:block;flex:1 1 auto;min-width:0;padding:6px 5px;font-size:11px;letter-spacing:.2px;
      overflow:hidden;text-overflow:ellipsis;text-align:center}
    .ds-tab-ico{display:none}
    .ds-foot{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:8px 10px}
    .ds-foot::-webkit-scrollbar{display:none}
    .ds-jobs{grid-template-columns:repeat(auto-fill,minmax(72px,1fr))}
  }
  `;
  document.head.appendChild(s);
}
