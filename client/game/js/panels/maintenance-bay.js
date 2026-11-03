// THE MAINTENANCE BAY: one controller for the four service bays.
//
// The truck depot, the marina, the hangar and the racer bay each put a garage over their seat's
// glass (depot-shell.js bayHtml). Each used to write its own copy of what goes on round the page:
// which job is open, which camera shot that job takes, remembering the seat's view and handing it
// back on a fold, and putting a preview on the vehicle and taking it off again. This file is that
// code, once. A depot hands it a seat adapter and, on every draw, the jobs and what to preview;
// what is on a job's page stays in the depot's own file.
//
// docs/proposals/maintenance-bay.md §7 is the design.
//
// ⚠ THE SEAT IS AN ADAPTER, NEVER A MODULE. Each seat exports one object built from the hooks it
// already had (cab-view.js cabBaySeat, boat-view.js boatBaySeat, cockpit.js cockpitBaySeat,
// podracer-view.js podracerBaySeat):
//
//   host()           the element the bay mounts in
//   frame(shot, ms)  ease the chase camera onto a SHOTS entry; null hands the seat's camera back
//   view(mode, o)    read the view ('ext' / 'cab') with no mode, set it with one; `o.enter` is
//                    true the first time the bay takes the camera. A seat with no inside leaves it out
//   preview(look)    put a look on the vehicle (the seat's own shape), or null to take it off
//   rev(amount)      blip the engine for the ear only, if it has one
//   frameRadius()    optional: how far off the vehicle the bay should stand (see fitZoom)
//
// ⚠ THE CAMERA MOVES ONLY ON A CHANGE OF SHOT. A re-push after a purchase draws the bay again and
// must leave the camera where the player dragged it, so `sync` remembers the shot it last asked for.
//
// ⚠ THE SERVER STILL DECIDES WHEN A BAY IS UP. This holds no timers and sends no verbs; a depot
// opens one when its push says `service` and closes it when the push or the seat goes.

import { SHOTS } from './camera-tween.js';
import { jobsHtml, groupsHtml } from './depot-shell.js';
import { registerKeyPanel, grabSeatKeys } from './seat-keys.js';

// THE PART AREAS (§3): where on the vehicle a job works, and the shot that shows it. A job may name
// a `shot` of its own to refine its area; the bay takes the area's when it doesn't.
export const AREA_SHOT = { front: 'quarter', flank: 'side', rear: 'rear', top: 'high', inside: 'inside' };

// THE EIGHT JOBS (§5), the same names, icons and order on every vehicle. A vehicle shows the ones
// it has; the number is the key that picks the job, so Paint is 5 on a truck and on a boat alike.
// ⚠ REPAIR AND SERVICE ARE TWO JOBS EVERYWHERE: "fix what's broken" and "replace what's worn" are
// the two questions a player walks in with.
export const JOBS = [
  { id: 'repair', label: 'Repair', ico: '🔧', area: 'front' },
  { id: 'service', label: 'Service', ico: '⛽', area: 'front' },
  { id: 'perf', label: 'Performance', ico: '🎛', area: 'front' },
  { id: 'parts', label: 'Parts', ico: '⚑', area: 'flank' },
  { id: 'paint', label: 'Paint', ico: '🎨', area: 'flank' },
  { id: 'inside', label: 'Inside', ico: '◇', area: 'inside' },
  { id: 'load', label: 'Load', ico: '▤', area: 'top' },
  { id: 'business', label: 'Business', ico: '₵', area: 'front' },
];

// The keys the bay takes while focus is inside it. Everything else (W to drive off, the horn) still
// reaches the seat. See seat-keys.js registerKeyPanel.
const BAY_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape']);
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const isField = (n) => !!n && (n.isContentEditable || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT'
  || (n.tagName === 'INPUT' && !/^(button|submit|checkbox|radio)$/i.test(n.type || 'text')));
// What a focused control is, so the same one can be found again after a redraw replaces it: its
// data attributes, or its words when it has none.
function focusKey(n) {
  const d = [...(n.attributes || [])].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => `${a.name}=${a.value}`);
  return `${n.tagName}|${d.join('|') || (n.textContent || '').trim().slice(0, 48)}`;
}

// ⚠ FITTED ZOOM IS OFF. With it on, a shot's zoom is scaled so the vehicle fills the same share of
// the stage on every seat, from the seat's `frameRadius()` over its resting distance. No seat gives
// a radius yet, so the radius defaults to the resting distance and the factor is 1. The renderer
// already scales the resting distance by the subject's size (windshield.js `szFac`).
const FIT_ZOOM = false;
function fitZoom(seat) {
  if (!FIT_ZOOM) return 1;
  const rest = Number(seat.restRadius?.()) || 0;
  const want = Number(seat.frameRadius?.()) || rest;
  return rest > 0 && want > 0 ? want / rest : 1;
}

// Every element a bay is attached to, so a press anywhere else can drop the focus each one keeps.
const attached = new Set();
let pressHooked = false;
function hookPress() {
  if (pressHooked || typeof document === 'undefined') return;
  pressHooked = true;
  document.addEventListener('pointerdown', (e) => {
    for (const el of attached) {
      if (!el.isConnected) { attached.delete(el); continue; }
      if (!el.contains(e.target) && el._bay) el._bay.focus = null;
    }
  }, true);
}

class Bay {
  constructor(seat, { job = null, open = true } = {}) {
    this.seat = seat;
    this.job = job;       // the open job's id
    this.open = open;     // open, or folded to its chip
    this.list = [];       // the jobs the depot last handed in
    this.subs = {};       // each job's open group
    this.groupList = [];  // the open job's groups, this draw
    this.taken = false;   // the bay holds the camera (and `view` is what the seat had before)
    this.view = null;
    this.shot = undefined;   // the shot last asked for: undefined before the first, null while not framing
    this.el = null;       // the bay's element, once attached
    this.focus = null;    // which control had the keyboard, so a redraw can give it back
    this.holding = null;  // a hold key Space is holding down
  }

  /** The jobs this draw, as [{ id, ico, label, sub, tone, area, shot, rev, key }]. Keeps `job` on one of them. */
  jobs(list) {
    this.list = Array.isArray(list) ? list : [];
    this.groupList = [];
    if (!this.list.some((j) => j.id === this.job)) this.job = this.list[0]?.id ?? null;
    return this;
  }

  /**
   * The canonical jobs this vehicle has: `have` maps a job id from JOBS to its tile's state
   * ({ sub, tone }, and `area` to move it off the job's own), or to true. Order, names, icons and
   * keys come from JOBS, so every depot's menu is the same menu.
   */
  canon(have = {}) {
    return this.jobs(JOBS.map((j, i) => (have[j.id] ? { ...j, key: String(i + 1), ...(have[j.id] === true ? {} : have[j.id]), id: j.id, label: j.label, ico: j.ico } : null)).filter(Boolean));
  }

  /**
   * The open job's groups (the old tabs inside it), [{ id, label, area }]. Returns the open group's
   * id; a group with an `area` moves the camera off the job's own.
   */
  groups(list) {
    this.groupList = Array.isArray(list) ? list : [];
    const ids = this.groupList.map((g) => g.id);
    if (!ids.includes(this.subs[this.job])) this.subs[this.job] = ids[0] ?? null;
    return this.subs[this.job];
  }
  /** The open group's id for a job (the open job by default). */
  sub(job = this.job) { return this.subs[job] ?? null; }
  /** The group strip for the top of the page. */
  groupsHtml() { return groupsHtml(this.groupList, this.subs[this.job]); }

  /** The job tiles for bayHtml's `jobs`. */
  railHtml() { return this.list.length ? jobsHtml(this.list, this.job) : ''; }

  current() { return this.list.find((j) => j.id === this.job) || null; }

  /**
   * A click on the bay. Handles a job tile, a group, and the fold and open keys, calling
   * `on.job(id)` or `on.group(id)` (the depot's own reset, if any) and then `on.redraw()`. Returns
   * true when it handled the click.
   */
  click(e, on = {}) {
    const t = e.target.closest?.('[data-ds-job],[data-ds-sub],[data-ds="bay-fold"],[data-ds="bay-open"]');
    if (!t || t.disabled) return false;
    if (t.dataset.dsJob) {
      if (t.dataset.dsJob !== this.job) { this.job = t.dataset.dsJob; on.job?.(this.job); }
      on.redraw?.();
      return true;
    }
    if (t.dataset.dsSub) {
      if (t.dataset.dsSub !== this.subs[this.job]) { this.subs[this.job] = t.dataset.dsSub; on.group?.(t.dataset.dsSub); }
      on.redraw?.();
      return true;
    }
    this.open = t.dataset.ds === 'bay-open';
    on.redraw?.();
    return true;
  }

  // ── The keyboard (§5) ──────────────────────────────────────────────────────
  // 1-8 pick a job, the arrows move through what is on the rail or the page, Enter picks (the
  // focused button's own click), Space pays (the till's key; held for a key that holds), Esc backs
  // out to the job and then folds the bay. ⚠ ONLY WHILE FOCUS IS IN THE BAY: the seats read their
  // controls off the window, and with focus anywhere else these keys still steer and brake.

  /** Wire the bay's element once: its keys, and remembering which control has focus. */
  attach(el) {
    if (!el) return this;
    this.el = el;
    if (el._bay === this) return this;
    el._bay = this;
    attached.add(el);
    hookPress();
    if (!el._bayKeys) {
      // The listeners are bound once per element and read `el._bay`, so a new bay on the same
      // element takes them over.
      el._bayKeys = true;
      el.addEventListener('keydown', (e) => el._bay?.onKey(e, el));
      el.addEventListener('keyup', (e) => el._bay?.onKeyUp(e, el));
      el.addEventListener('focusin', (e) => { if (el._bay) el._bay.focus = focusKey(e.target); });
      el.addEventListener('focusout', (e) => { if (el._bay && e.relatedTarget && !el.contains(e.relatedTarget)) el._bay.focus = null; });
      registerKeyPanel(el, (e) => !!el._bay?.takesKey(e, el));
    }
    return this;
  }

  /** Whether a key press is the bay's: one of its keys, with focus in it and not in a field. */
  takesKey(e, el = this.el) {
    if (!this.open || !el || !BAY_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return false;
    return el.contains(e.target) && !isField(e.target);
  }

  onKey(e, el) {
    if (!this.takesKey(e, el)) return;
    const k = e.key, t = e.target;
    if (/^[1-8]$/.test(k)) {
      const tile = el.querySelector(`[data-ds-job][aria-keyshortcuts="${k}"]`);
      if (!tile) return;
      e.preventDefault();
      tile.click();
      el.querySelector('.ds-job.on')?.focus({ preventScroll: true });
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      const tile = el.querySelector('.ds-job.on');
      if (t.closest('.ds-gx-page') && tile) { tile.focus({ preventScroll: true }); return; }
      this.focus = null;
      el.querySelector('[data-ds="bay-fold"]')?.click();
      grabSeatKeys();
      return;
    }
    if (k === ' ') {
      // A focused hold key holds itself (hold-confirm.js); anything else pays at the till.
      if (t.classList?.contains('confirm-hold')) return;
      e.preventDefault();
      if (e.repeat) return;
      const pay = el.querySelector('.ds-gx-till .ds-btn.primary:not([disabled])');
      if (!pay) return;
      if (pay.classList.contains('confirm-hold')) { this.holding = pay; pay.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); }
      else pay.click();
      return;
    }
    if (k === 'Enter') return;   // the focused button's own click
    // The arrows: through the rail's tiles, or through the page's slots and options. Right from the
    // rail goes into the page; Left from the page's first control goes back to the rail.
    e.preventDefault();
    const inRail = !!t.closest('.ds-gx-rail');
    const page = el.querySelector('.ds-gx-page'), rail = el.querySelector('.ds-gx-rail');
    const list = (n) => (n ? [...n.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length) : []);
    if (inRail && k === 'ArrowRight') { list(page)[0]?.focus({ preventScroll: false }); return; }
    const region = inRail ? rail : t.closest('.ds-gx-page') ? page : el;
    const all = list(region);
    if (!all.length) return;
    const i = all.indexOf(t);
    if (!inRail && region === page && k === 'ArrowLeft' && i <= 0) { el.querySelector('.ds-job.on')?.focus({ preventScroll: true }); return; }
    const d = k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;
    all[i < 0 ? 0 : (i + d + all.length) % all.length].focus({ preventScroll: false });
  }

  onKeyUp(e, el) {
    if (e.key !== ' ') return;
    if (this.holding) { const h = this.holding; this.holding = null; e.preventDefault(); h.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })); return; }
    // ⚠ A button clicks on the keyup of Space; the bay already paid on the keydown.
    if (this.takesKey(e, el) && !e.target.classList?.contains('confirm-hold')) e.preventDefault();
  }

  /** After a redraw replaced the control that had focus, give focus to the same control again. */
  refocus() {
    const el = this.el;
    if (!el || !this.focus || !this.open || typeof document === 'undefined') return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) { if (!el.contains(a)) this.focus = null; return; }
    const n = [...el.querySelectorAll(FOCUSABLE)].find((x) => focusKey(x) === this.focus) || el.querySelector('.ds-job.on');
    n?.focus({ preventScroll: true });
  }

  /**
   * After every draw: the camera, the seat's view and the preview. `area` and `shot` default to the
   * open job's; pass `area: null` for a bay with no camera (the marina's fuel float). `look` is what
   * goes on the vehicle, in the seat's own shape; pass the folded look when the bay is folded.
   */
  sync({ area, shot, look = null } = {}) {
    const s = this.seat;
    const job = this.current();
    const grp = this.groupList.find((g) => g.id === this.subs[this.job]);
    const a = area === undefined ? (grp?.area || job?.area) : area;
    const key = !this.open || !a ? null : (shot || (area === undefined ? (grp?.area ? grp.shot : job?.shot) : null) || AREA_SHOT[a] || 'quarter');
    try {
      if (!key) this.restore();
      else {
        const first = !this.taken;
        if (first) { this.taken = true; this.view = s.view ? s.view() : null; }
        const mode = key === 'inside' ? 'cab' : 'ext';
        if (s.view && (first || s.view() !== mode)) s.view(mode, { enter: first });
        if (key !== this.shot) {
          if (key !== 'inside') {
            const sh = SHOTS[key] || SHOTS.quarter, z = fitZoom(s);
            s.frame(z === 1 ? sh : { ...sh, zoom: sh.zoom * z }, first ? 900 : 700);
          }
          // A job that revs the engine (the truck's tuning) does it on the way in, not on the first shot.
          if (job?.rev && this.shot !== undefined) s.rev?.(job.rev);
          this.shot = key;
        }
      }
      s.preview?.(look);
    } catch { /* a seat without the hooks is a seat without the camera and the preview */ }
    this.refocus();
  }

  /** Hand the seat's camera and view back. The bay may take them again on the next sync. */
  restore() {
    const s = this.seat;
    if (this.taken) {
      try { s.frame?.(null); if (this.view != null) s.view?.(this.view); } catch { /* the seat can already be gone */ }
      this.taken = false;
      this.view = null;
    }
    if (this.shot !== undefined) this.shot = null;
  }

  /** A blip of the engine, if the seat has one. */
  rev(amount) { try { return !!this.seat.rev?.(amount); } catch { return false; } }

  /** The bay is going: the view back, and `rest` (the vehicle's own look, or null) on the vehicle. */
  close(rest = null) {
    this.restore();
    try { this.seat.preview?.(rest); } catch { /* gone */ }
    if (this.el?._bay === this) { this.el._bay = null; attached.delete(this.el); }
    this.el = null; this.focus = null;
  }
}

/**
 * Open a bay on `seat`. `job` is the job to start on and `open` whether it starts open (a Deploy
 * from the counter starts it folded). A depot keeps the returned bay across its pushes and drops it
 * with `close` when the seat or the shed goes.
 */
export function openBay({ seat, job = null, open = true } = {}) {
  return new Bay(seat || {}, { job, open });
}
