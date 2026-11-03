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
import { jobsHtml } from './depot-shell.js';

// THE PART AREAS (§3): where on the vehicle a job works, and the shot that shows it. A job may name
// a `shot` of its own to refine its area; the bay takes the area's when it doesn't.
export const AREA_SHOT = { front: 'quarter', flank: 'side', rear: 'rear', top: 'high', inside: 'inside' };

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

class Bay {
  constructor(seat, { job = null, open = true } = {}) {
    this.seat = seat;
    this.job = job;       // the open job's id
    this.open = open;     // open, or folded to its chip
    this.list = [];       // the jobs the depot last handed in
    this.taken = false;   // the bay holds the camera (and `view` is what the seat had before)
    this.view = null;
    this.shot = undefined;   // the shot last asked for: undefined before the first, null while not framing
  }

  /** The jobs this draw, as [{ id, ico, label, sub, tone, area, shot, rev }]. Keeps `job` on one of them. */
  jobs(list) {
    this.list = Array.isArray(list) ? list : [];
    if (!this.list.some((j) => j.id === this.job)) this.job = this.list[0]?.id ?? null;
    return this;
  }

  /** The job tiles for bayHtml's `jobs`. */
  railHtml() { return this.list.length ? jobsHtml(this.list, this.job) : ''; }

  current() { return this.list.find((j) => j.id === this.job) || null; }

  /**
   * A click on the bay. Handles a job tile and the fold and open keys, calling `on.job(id)` (the
   * depot's own reset, if any) and then `on.redraw()`. Returns true when it handled the click.
   */
  click(e, on = {}) {
    const t = e.target.closest?.('[data-ds-job],[data-ds="bay-fold"],[data-ds="bay-open"]');
    if (!t || t.disabled) return false;
    if (t.dataset.dsJob) {
      if (t.dataset.dsJob !== this.job) { this.job = t.dataset.dsJob; on.job?.(this.job); }
      on.redraw?.();
      return true;
    }
    this.open = t.dataset.ds === 'bay-open';
    on.redraw?.();
    return true;
  }

  /**
   * After every draw: the camera, the seat's view and the preview. `area` and `shot` default to the
   * open job's; pass `area: null` for a bay with no camera (the marina's fuel float). `look` is what
   * goes on the vehicle, in the seat's own shape; pass the folded look when the bay is folded.
   */
  sync({ area, shot, look = null } = {}) {
    const s = this.seat;
    const job = this.current();
    const a = area === undefined ? job?.area : area;
    const key = !this.open || !a ? null : (shot || (area === undefined ? job?.shot : null) || AREA_SHOT[a] || 'quarter');
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
