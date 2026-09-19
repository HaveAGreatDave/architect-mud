// FREELOOK — the detached camera with no vehicle under it.
//
// The three seats in this renderer (cab-view, cockpit, helm-view) are each a vehicle with a camera
// bolted to it, and each of them can take that camera off its mount. This is the camera with the
// vehicle deleted: a world window, a sky, and freecam.js flying through it.
//
// ⚠ IT IS ALMOST ENTIRELY OTHER PEOPLE'S CODE, AND THAT IS THE POINT. `paintWindshield` is handed
// the same shape the helm hands it — `external` + `hideOwnShip`, a map, a centre, a sky — so every
// building, light, sign, cloud, shadow and blade of grass is drawn by the renderer that draws them
// everywhere else. There is no second scene here and there must never be one: the whole worth of
// this view is that what you are looking at is what the game looks like.
//
// ⚠ AND THERE IS NO SUBJECT. The three seats frame a vehicle; this frames nothing, so the camera
// opens already detached and can never be stowed back onto a mount that does not exist. `O` and the
// ✕ close the VIEW rather than the camera — which is the one place this deliberately reads
// differently from the seats, and the hint says so.
//
// The server half is plugins/freelook/. Nothing here decides anything: the window and the sky
// arrive, and closing fires the ordinary `freelook close` verb so the server drops the viewer row
// rather than this file assuming it did.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, normalizeWx, navMarks } from './windshield.js';
import { createFreeCam, FREECAM_HINT, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';

// Live world clock/weather through the shared env system — loaded OPTIONALLY, exactly as helm-view
// loads it, so a context that cannot provide it still runs on the sky the server sent rather than
// failing the whole module at import time.
let _getEnvSnapshot = null;
import('./environment.js').then((m) => { _getEnvSnapshot = m.getEnvSnapshot; }).catch(() => {});

function liveEnv() {
  if (!_getEnvSnapshot) return null;
  try {
    const s = _getEnvSnapshot();
    if (!s || !s.time) return null;
    const [h, m] = s.time.split(':').map(Number);
    return { hour: (h || 0) + (m || 0) / 60, weather: normalizeWx(s.weatherType), moon: s.moonPhase };
  } catch { return null; }
}

// Where the camera stands when it opens: a little above head height, looking north. Not on the
// ground — a camera that opens with its lens in the tarmac reads as broken — and not up in the air
// either, because the first thing anybody wants to see is the street they typed the verb on.
const OPEN_Z = 1.4;

let st = null;

export function isFreelookActive() { return !!st; }

export function freelookSetSky(sky) {
  if (!st || !sky) return;
  st.field = sky.field || st.field;
  if (typeof sky.hour === 'number') st.hour = sky.hour;
  if (sky.weather) st.weather = String(sky.weather).toLowerCase();
  if (sky.moon != null) st.moon = sky.moon;
  st.event = sky.event || null;
}

export function openFreelook(ctx = {}) {
  const mount = ctx.mount || document.getElementById('area-content');
  if (!mount) return null;
  // Re-centring is an OPEN with a new window, not a second view: the server sends the same
  // `freelook_open` either way. Swap the ground under the camera and leave the camera where it is,
  // so `freelook 918 903` from an open view moves the world and not the shot.
  if (st && ctx.map) {
    st.map = ctx.map; st.gx = ctx.gx ?? st.gx; st.gy = ctx.gy ?? st.gy;
    freelookSetSky(ctx.sky);
    return st.api;
  }
  closeFreelook();
  ensureWindshieldStyles();
  ensureFreelookStyles();
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until an app says it owns it

  const id = 'freelook-' + Math.random().toString(36).slice(2, 8);
  mount.innerHTML = `<div class="fl-root">`
    + `<div class="fl-view">${windshieldHTML(id, 'FREE LOOK')}</div>`
    + `<div class="fl-chips">`
    + `<span class="fl-chip" data-at></span>`
    + `<span class="fl-chip" data-wx></span>`
    + `<button class="fl-chip fl-x" type="button" title="close the camera (O)">✕</button>`
    + `</div>`
    + `<div class="fl-hint"></div>`
    + `</div>`;

  const root = mount.querySelector('.fl-root');
  const freeCam = createFreeCam();

  st = {
    id, mount, root, freeCam,
    gx: ctx.gx ?? 0, gy: ctx.gy ?? 0,
    map: ctx.map || null,
    hour: 12, weather: 'clear', moon: undefined, field: null, event: null,
    alive: true, raf: 0, last: performance.now(),
    onExit: ctx.onExit || (() => {}),
    api: null,
  };
  freelookSetSky(ctx.sky);

  // ⚠ OPEN ALREADY DETACHED. There is no mount to be on, so the "stowed" state of the camera is not
  // a state this view has — a stowed camera here would be a frozen frame with no controls at all.
  freeCam.open({ yaw: 0, z: OPEN_Z });

  const hintEl = root.querySelector('.fl-hint');
  // The seats' own hint, with the one line that differs replaced: O stows the camera there and
  // closes the view here, and a hint that lied about the way out is worse than no hint.
  hintEl.textContent = FREECAM_HINT.replace('O exit', 'O close');

  const atEl = root.querySelector('[data-at]');
  const wxEl = root.querySelector('[data-wx]');

  function frame(now) {
    if (!st || !st.alive) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
    // The whole body is guarded for the reason helm-view's is: this loop reschedules itself at the
    // END and paintWindshield has no try/catch of its own, so one throw would freeze the view for
    // good while everything around it carried on.
    try {
      freeCam.step(dt);
      const env = liveEnv();
      const hour = env ? env.hour : st.hour;
      const weather = env ? env.weather : st.weather;
      const moon = env ? env.moon : st.moon;

      paintWindshield(st.id, {
        external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
        heading: 0, height: 0, speed: 0,
        hour, moon, weather, wxField: st.field, event: st.event,
        map: st.map, mapCenter: { x: st.gx, y: st.gy }, mapOffset: { x: 0, y: 0 },
        acX: st.gx, acY: st.gy, airport: 'default',
        freeCam: freeCam.view(),
      });

      if (atEl) atEl.textContent = `${st.gx},${st.gy}`;
      if (wxEl) wxEl.textContent = `${String(weather || 'clear').toUpperCase()} · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
    } catch (e) {
      if (!st._errLogged) { console.error('[freelook] frame render error (view kept alive — report this stack):', e); st._errLogged = true; }
    }
    st.raf = requestAnimationFrame(frame);
  }
  st.raf = requestAnimationFrame(frame);

  const freeIdle = bindFreeCamIdle(freeCam);
  freeIdle.wake();
  const unbindPointer = bindFreeCamPointer(root.querySelector('.ws-wrap') || root, freeCam);

  function onKey(e) {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = (e.key || '').toLowerCase();
    const down = e.type === 'keydown';
    // ⚠ O CLOSES THE VIEW, NOT THE CAMERA. In a seat the camera goes back on its mount and the
    // vehicle is still there; here there is nothing to go back to, so the same key has to mean the
    // same thing to the player — "put this away" — and what it puts away is the whole view.
    if (k === 'o' && down && !e.repeat) { e.preventDefault(); st.onExit(); return; }
    // The nav-mark switch is bound here too, even though this view suppresses the marks whatever it
    // is set to (a detached camera always does — see NAV_MARKS in windshield.js). It is the same
    // module flag the seats throw, so a builder who turns it off out here has turned it off in the
    // cab they get into next, which is very likely what they meant.
    if (k === 'n' && down && !e.repeat) { e.preventDefault(); navMarks(); return; }
    if (freeCam.onKey(k, down)) e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  root.querySelector('.fl-x')?.addEventListener('click', () => st?.onExit());

  st.teardown = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    unbindPointer?.();
    freeIdle.unbind();
  };
  st.api = {
    setSky: freelookSetSky,
    recentre(rows, gx, gy) { if (Array.isArray(rows) && rows.length) st.map = rows; if (gx != null) st.gx = gx; if (gy != null) st.gy = gy; },
  };
  return st.api;
}

export function closeFreelook() {
  if (!st) return;
  const s = st; st = null;
  s.alive = false;
  cancelAnimationFrame(s.raf);
  try { s.teardown?.(); } catch { /* a half-built view still has to come down */ }
  // ⚠ THE GL SCENE GOES WITH IT. This view mints a fresh canvas id per open (the helm's own trap,
  // written up at disposeWindshield): without this, every open would leave a WebGL context, its
  // atlas page and its float targets behind, and the browser force-loses the OLDEST context past
  // sixteen — which is the seat somebody is actually flying.
  try { s.freeCam.close(); } catch { /* ditto */ }
  try { disposeWindshield(s.id); } catch { /* ditto */ }
  window.dispatchEvent(new Event('pane:released'));
  if (s.mount) s.mount.innerHTML = '';
}

function ensureFreelookStyles() {
  const el = document.getElementById('freelook-styles') || document.createElement('style');
  el.id = 'freelook-styles';
  // Rewritten every time rather than early-returned, for the reason helm-mode gives: a stale block
  // left by an older build would pin the old layout under this module's fresh JS.
  el.textContent = `
    #area-content:has(.fl-root){ height:100%; overflow:hidden; overscroll-behavior:contain; touch-action:none; }
    .fl-root{ position:relative; width:100%; height:100%; min-height:380px; overflow:hidden;
      overscroll-behavior:contain; touch-action:none; background:#05070b; }
    .fl-view, .fl-view .ws-wrap{ position:absolute; inset:0; }
    /* The chrome fades with the rest of the free camera's — see bindFreeCamIdle. Anything on this
       glass is in the shot, and the two things that cannot simply go are the way out and the way
       out written down, so they go on a timer instead. */
    .fl-chips{ position:absolute; top:8px; right:8px; z-index:6; display:flex; gap:6px; align-items:center;
      transition:opacity .35s linear; }
    .fl-chip{ font:10px/1 monospace; letter-spacing:1px; color:#dfe6ef; background:rgba(8,11,15,0.62);
      border:1px solid rgba(255,255,255,0.16); border-radius:9px; padding:5px 9px; }
    button.fl-chip{ cursor:pointer; }
    button.fl-chip:hover{ border-color:rgba(255,255,255,0.42); }
    .fl-hint{ position:absolute; left:50%; bottom:12px; transform:translateX(-50%); z-index:6;
      font:11px/1 system-ui,sans-serif; letter-spacing:0.6px; color:#dfe6ef; background:rgba(8,11,15,0.62);
      padding:4px 12px; border-radius:11px; border:1px solid rgba(255,255,255,0.16);
      pointer-events:none; white-space:nowrap; transition:opacity .35s linear; }
    body.freecam-idle .fl-chips, body.freecam-idle .fl-hint{ opacity:0; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
