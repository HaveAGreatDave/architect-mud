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

// ⚠ THROUGH THE LAZY FACADE, NOT THE MODULE. `windshield.js` is 3.8 MB and with `aircraft3d.js`
// behind it is 43.6% of the cold boot payload — and a seat is the only thing that ever needs it.
// Imported directly it sits in the eager graph, so every player who has never opened a view
// downloads and parses the whole 3-D stack before they can type `look`. The facade has the same
// export names, so nothing below this line changed; what changed is that the bytes arrive when the
// seat is opened. See scripts/client/bake-lazy-view.mjs.
import { loadWindshield, isLoaded as windshieldLoaded, paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, normalizeWx, navMarks, yachtScopeMount } from './windshield-lazy.js';
export { loadWindshield };
import { createFreeCam, FREECAM_HINT, FREECAM_STAND_HINT, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { bindBigScreenButton, exitBigScreen, setSidebarHidden, bindSidebarButton, BIGSCREEN_GLYPH, BIGSCREEN_TITLE, SIDEBAR_GLYPH, SIDEBAR_TITLE } from './bigscreen.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';

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

// ── ⚠ THE CAMERA CAN OUTRUN ITS OWN WORLD, AND NOTHING SAID SO ───────────────
//
// The window the server sends is `FLIGHT_RADIUS` (36) tiles around the tile the camera OPENED on,
// and this camera then flies anywhere it likes. Past the edge of that square there are no cells at
// all — so the ground goes on (the floor shader draws terrain from its own LUT) and everything
// STANDING on it silently stops: buildings, lights, signs, and the Architect's Curtain.
//
// ⚠ IT PRESENTS AS ONE THING MISSING, NEVER AS AN EDGE. That is what makes it hard to read: the
// city is 30 tiles across and the walls seal its rim, so flying the camera out to frame the whole
// place puts exactly one wall past the window while the other two are still in it. Reported as
// "the western wall of the Curtain is missing", and measured: the same shot with the window centred
// 10 tiles east uploads 46 Curtain segments instead of 67 — the west run's 19, gone, with nothing
// in any log and the rest of the frame perfect.
//
// So the world follows the camera. `freelook <x> <y>` is already a re-centre the server and
// `openFreelook` both understand, and this is that verb fired by the camera rather than by a
// person. Half the radius is the drift it allows: at 18 tiles the nearest hole is still further
// than most shots reach, and a window push costs a 73×73 payload, so the number is a budget as
// much as a distance (this is a staff view, but a push every couple of seconds is still a push).
const RECENTER_R = 18;

// ── STANDING SOMEWHERE, RATHER THAN FLYING ───────────────────────────────────
//
// The same view with the camera on its feet: a vantage — a telescope on a sun deck, and whatever
// else gets bolted down later — opens this with a `stand` block and gets mouse-look and WASD inside
// a leash instead of a camera that flies. Everything else about the view is the one above: the same
// window, the same sky, the same renderer, the same way out.
//
// ⚠ AND THE EYE HEIGHT IS THE RENDERER'S TO ANSWER, WHICH IS WHY THERE IS A MOUNT TABLE AND NOT A
// NUMBER ON THE WIRE. A telescope on the Echelon's sun deck stands on a deck whose height is a
// property of her MODEL and whose position is a function of the swell — neither of which the server
// knows or should. So a vantage names a mount, the renderer answers where that is, and the number
// is never written down twice. A vantage with no mount may still author a plain `eye`, which is
// right for anything standing on ground that does not move.
//
// ⚠ THE CENTRE CELL IS THE SHIP. `mapWindow` centres on her tile, so the thing this camera is
// standing on is `map[R][R]`, and `heading` on that cell is the course she is lying on — the same
// field `drawYacht` is handed. Read per frame rather than captured, because she swings at anchor.
const MOUNTS = {
  yacht_scope(map, R, now) {
    const c = map?.[R]?.[R];
    if (!c || c.mark !== 'yacht') return null;
    return yachtScopeMount(0, 0, c.heading || 0, now);
  },
};

// ── A VANTAGE BUYS ITSELF MORE OF THE CITY ───────────────────────────────────
//
// Every LOD number in this renderer is set for a camera that is MOVING: a cab doing 50 through a
// dense night block has a frame budget, and `lodNear`, `decoFar` and `glowFar` are where it is
// spent. A vantage has none of that. It is bolted down, the world in front of it is the same world
// it was a second ago, and what it is FOR is looking at the far side of the Basin — so it is the one
// seat in the game that can afford to draw more and the one where drawing less is most obviously
// wrong. A telescope that showed you a coarser city than the truck you drove there in is a
// telescope with the lens in backwards.
//
// ⚠ IT GOES THROUGH `tune`, THE PER-SEAT SEAM, AND NOT THROUGH `RENDER_TUNE`. These are the player's
// own sliders; a view that wrote them would raise the detail for the cab they get into next and
// there would be nothing on screen saying why their frame rate had changed. `resolveTune` rebuilds
// the merge from `RENDER_TUNE` every frame, so a slider the player moves still reaches this seat.
//
// ⚠ AND EVERY KEY HERE IS IN `VIEW_TUNABLE`. One that is not is dropped with a console warning and
// nothing else — a detail setting that silently does nothing looks exactly like one that is already
// at its ceiling. `detailNear` is deliberately absent from that set and so is not here: it is the
// ring the near adornment tier runs in, and its own gate records 3→6 taking a dense night block
// from 21.0 ms to 24.3.
//
// ⚠ AND `texRes` IS DELIBERATELY NOT HERE, THOUGH IT IS TUNABLE. It is the one detail knob that can
// make the picture WORSE rather than slower: every surface in the city at 2 wants a 2048×4096 atlas
// page, the WebGL2 floor guarantee is only 2048 square, and `buildAtlas` answers a page it cannot
// fit by dropping the whole city to flat palette colours with one warning. A vantage that traded a
// crisper wall for a city with no texture on it at all would be the opposite of this feature.
const STAND_TUNE = { lodNear: 32, decoFar: 26, glowFar: 20, shadowFar: 26 };

let st = null;

export function isFreelookActive() { return !!st; }

export function freelookSetSky(sky) {
  if (!st || !sky) return;
  st.field = sky.field || st.field;
  st.ground = sky.ground || st.ground;
  if (typeof sky.hour === 'number') st.hour = sky.hour;
  if (sky.weather) st.weather = String(sky.weather).toLowerCase();
  if (sky.moon != null) st.moon = sky.moon;
  st.event = sky.event || null;
}

export function openFreelook(ctx = {}) {
  const mount = ctx.mount || document.getElementById('area-content');
  if (!mount) return null;
  // ⚠ THE FIRST OPEN FETCHES THE RENDERER AND SO RETURNS null, WHICH IS A CHANGE OF CONTRACT AND
  // IS SAID HERE BECAUSE NOTHING ELSE WOULD SAY IT. The seat re-enters itself once the module is
  // in and opens exactly as before; every open after that is synchronous, because the facade
  // caches. `dispatch.js` ignores the return, which is what makes this safe there — a caller that
  // needs the api on a cold open awaits `loadWindshield()` first, as the smoke does.
  if (!windshieldLoaded()) { loadWindshield().then(() => openFreelook(ctx)).catch(() => {}); return null; }
  // Re-centring is an OPEN with a new window, not a second view: the server sends the same
  // `freelook_open` either way. Swap the ground under the camera and leave the camera where it is,
  // so `freelook 918 903` from an open view moves the world and not the shot.
  // ⚠ A VANTAGE IS NOT A RE-CENTRE, so it never takes the branch below. Re-centring keeps the shot
  // and slides the world under it, which is exactly wrong for somebody who has just walked up to a
  // different telescope: the camera has to be put down where the new one is, on its own mount, with
  // its own leash and its own name in the corner. Told apart on the mount rather than on `stand`
  // being set at all, so the same vantage re-sending its window is still a cheap swap.
  if (st && ctx.map && (ctx.stand?.mount || null) !== (st.stand?.mount || null)) { closeFreelook(); }
  if (st && ctx.map) {
    const ogx = st.gx, ogy = st.gy;
    st.map = ctx.map; st.gx = ctx.gx ?? st.gx; st.gy = ctx.gy ?? st.gy;
    // ⚠ AND THE CAMERA IS REBASED ONLY WHEN IT ASKED. The two re-centres arrive down the same wire
    // and want opposite things: a person typing `freelook 918 903` is naming a place to LOOK AT and
    // keeps the shot while the world slides under it, and the drift follow above is moving the
    // origin out from under a camera that has not moved at all. Matching the tile this view
    // requested is what tells them apart — anything else is somebody else's re-centre.
    if (st.want && st.want.x === st.gx && st.want.y === st.gy) st.freeCam.rebase(ogx - st.gx, ogy - st.gy);
    st.want = null;
    freelookSetSky(ctx.sky);
    return st.api;
  }
  closeFreelook();
  ensureWindshieldStyles();
  ensureFreelookStyles();
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until an app says it owns it

  const id = 'freelook-' + Math.random().toString(36).slice(2, 8);
  // A vantage names itself, because "FREE LOOK" over a telescope is the tool's name rather than the
  // thing the player is holding — and this corner label is the only place the view says what it is.
  const stand = ctx.stand || null;
  const label = (stand?.label || 'FREE LOOK').toUpperCase().slice(0, 18);
  mount.innerHTML = `<div class="fl-root">`
    + `<div class="fl-view">${windshieldHTML(id, label)}</div>`
    // ── THE SYSTEM CORNER ──────────────────────────────────────────────────
    // What every other seat puts in its top right and nothing else: how big the picture is, which
    // camera it is from, and the way out. Free look had two readouts, big screen and ✕, and none of
    // the ladder — so it is the one seat where the only choice was the whole page or two thirds of
    // a column. Reading outward to the corner: ◧ takes the sidebar, ⊟ the log, ⛶ the command box
    // with it, ⤢ the page; FPS is the camera rather than the screen and sits before them; ✕ is last
    // because it is the way off, which is where the wheelhouse puts its own.
    + `<div class="fl-chips">`
    + `<span class="fl-chip" data-at></span>`
    + `<span class="fl-chip" data-wx></span>`
    // ⚠ A VANTAGE DOES NOT GET THIS ONE. It is already standing, on a mount that re-asserts its eye
    // height every frame, and the whole of what a telescope is is that you cannot walk off with it.
    + (stand ? '' : `<button class="fl-chip fl-fps" type="button"></button>`)
    + `<button class="fl-chip fl-side" type="button" title="${SIDEBAR_TITLE}">${SIDEBAR_GLYPH}</button>`
    + `<button class="fl-chip fl-hide" type="button" title="hide the text panel — more picture">⊟</button>`
    + `<button class="fl-chip fl-fs" type="button" title="fullscreen — the log and the command box too">⛶</button>`
    + `<button class="fl-chip fl-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`
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
    want: null,                       // the re-centre this view has asked for and not yet been given
    onRecenter: ctx.onRecenter || null,
    stand,
    hour: 12, weather: 'clear', moon: undefined, field: null, ground: null, event: null,
    alive: true, raf: 0, last: performance.now(),
    onExit: ctx.onExit || (() => {}),
    api: null,
  };
  freelookSetSky(ctx.sky);

  // ⚠ OPEN ALREADY DETACHED. There is no mount to be on, so the "stowed" state of the camera is not
  // a state this view has — a stowed camera here would be a frozen frame with no controls at all.
  //
  // Standing, the seed is where the vantage IS: the mount answers with a world-tile offset from the
  // tile the window is centred on, which is exactly the vocabulary the camera's own x/y are in.
  const spot = stand ? standSpot(st, performance.now()) : null;
  // ⚠ THE MOUNT'S OWN BEARING OUTRANKS THE AUTHORED ONE. An instrument on a ship points where the
  // ship is pointing plus its own train angle, and a world yaw written into a content file would be
  // right on the day it was authored and wrong the first time she was sailed anywhere. A vantage on
  // ground that does not move has no mount and keeps its authored yaw.
  freeCam.open(spot
    ? { stand: true, yaw: spot.yaw != null ? spot.yaw : (stand.yaw || 0), x: spot.x, y: spot.y, z: spot.z, eye: spot.z, leash: stand.leash }
    : { yaw: 0, z: OPEN_Z });

  const hintEl = root.querySelector('.fl-hint');
  // The seats' own hint, with the one line that differs replaced: O stows the camera there and
  // closes the view here, and a hint that lied about the way out is worse than no hint.
  //
  // ⚠ AND IT FOLLOWS THE MODE RATHER THAN THE OPEN. The standing line is a DIFFERENT SENTENCE and
  // not the flying one with three clauses struck out — freecam.js's own note says why — so a
  // camera that has put its feet down while still advertising the orbit, the roll and the up-down
  // is advertising three controls that now refuse, which is the first minute of somebody deciding
  // the camera is broken.
  function paintHint() {
    hintEl.textContent = freeCam.standing
      ? FREECAM_STAND_HINT.replace('O steps back', stand ? 'O or ✕ steps back' : 'O or ✕ closes')
      : FREECAM_HINT.replace('O exit', 'O close');
  }
  paintHint();

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

      // ⚠ AND THE DECK UNDER A STANDING CAMERA MOVES. The Echelon heaves, pitches and rolls on the
      // same swell her hull is drawn standing in, so her sun deck is at a different height every
      // frame — and a camera pinned to a number taken when the view opened would hang in the air
      // while the ship rose and fell under it. One call, every frame, to the function that puts
      // her own geometry there.
      if (st.stand) { const s = standSpot(st, now); if (s) freeCam.setEye(s.z); }

      // THE WORLD FOLLOWS THE CAMERA — see RECENTER_R. One request outstanding at a time, cleared
      // by the window arriving, which is also the throttle: the next one cannot fire until the
      // camera has drifted the same distance again from the NEW centre.
      //
      // ⚠ NOT WHILE STANDING, AND SAID RATHER THAN LEFT TO THE ARITHMETIC. A leash is a fraction of
      // a tile, so the test below could never fire — but the reason it must not is that a vantage
      // is a PLACE, and a window that slid out from under one would be the ground moving while the
      // player stood still on it.
      const fc = freeCam.view();
      if (fc && !st.stand && st.onRecenter && !st.want
          && (Math.abs(fc.x) > RECENTER_R || Math.abs(fc.y) > RECENTER_R)) {
        const nx = st.gx + Math.round(fc.x), ny = st.gy + Math.round(fc.y);
        st.want = { x: nx, y: ny };
        st.onRecenter(nx, ny);
      }

      paintWindshield(st.id, {
        external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
        heading: 0, height: 0, speed: 0,
        hour, moon, weather, wxField: st.field, wxGround: st.ground, event: st.event,
        map: st.map, mapCenter: { x: st.gx, y: st.gy }, mapOffset: { x: 0, y: 0 },
        acX: st.gx, acY: st.gy, airport: 'default',
        tune: st.stand ? STAND_TUNE : undefined,   // see STAND_TUNE — a seat that cannot move can afford to draw more
        freeCam: freeCam.view(),
      });

      // ⚠ WHERE THE CAMERA IS, NOT WHERE THE WINDOW IS CENTRED. This read `st.gx,st.gy`, which is
      // the tile the view OPENED on — so the one readout in the view was a constant, and the whole
      // hour spent working out where the missing wall was went past a chip that could have said.
      if (atEl) atEl.textContent = fc ? `${Math.round(st.gx + fc.x)},${Math.round(st.gy + fc.y)}` : `${st.gx},${st.gy}`;
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
    const k = (e.key || '').toLowerCase();
    const down = e.type === 'keydown';
    // ⚠ A PRESS ONLY COUNTS WHILE THIS SEAT HAS THE KEYBOARD, AND A RELEASE COUNTS WHEREVER IT IS
    // DELIVERED. The typing guard is right for a keydown — somebody writing a message must not be
    // flying the camera — and it was catastrophic for a keyup: click into the command box with E
    // down (or let input.js's auto-focus take it there for you) and the release is addressed to an
    // INPUT, dropped here, and never taken out of the camera's held set. The shot then swings at
    // 62°/s for the rest of the session with nothing held down and nothing on screen to say why.
    // Same rule, and the same reason, as cab-view.js's own HOLD_KEYS record.
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) {
      if (!down) freeCam.onKey(k, false);
      return;
    }
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
  // ⚠ AND ALT-TAB IS THE ONE THE LENIENCY ABOVE CANNOT CATCH. The keyup for whatever was held goes
  // to whatever you switched to and this window never hears it at all, so there is no release to be
  // lenient about — the camera simply flies on, over a city nobody is looking at, until somebody
  // comes back and presses the key again to let go of it. The cab binds both hooks for the same
  // failure and for the same reason: `blur` is "this window is no longer taking keys" and
  // `visibilitychange` is "this tab is not on screen", and either can happen without the other.
  const onLetGo = () => freeCam.releaseAll();
  const onHidden = () => { if (document.hidden) freeCam.releaseAll(); };
  window.addEventListener('blur', onLetGo);
  document.addEventListener('visibilitychange', onHidden);
  root.querySelector('.fl-x')?.addEventListener('click', () => st?.onExit());
  // ⤢ big screen — the whole window with nothing on it, which is what this view was always
  // reaching for: no sidebar, no log, no chips, no hint, no pane border. It is the only seat with
  // no ⛶ ladder under it, because there is no cockpit here to make room for — the pane was already
  // all picture, and the only thing left to take is the page.
  // ⚠ ESC LEAVES BIG SCREEN AND O STILL CLOSES THE VIEW. Two ways out of two different things, and
  // the second one goes on working in here — which is why this button is safe to let fade with the
  // rest of the chrome.
  bindBigScreenButton(root.querySelector('.fl-big'));
  bindSidebarButton(root.querySelector('.fl-side'));

  // ⊟ and ⛶ — the column ladder, the same two body classes every other seat carries and the same
  // precedence: fullscreen supersedes hide-panel, so a player who learned it in a cab does not have
  // to learn it again out here. Both are cleared when the view closes, because they are the PAGE's
  // and nothing else takes them down.
  const hideBtn = root.querySelector('.fl-hide');
  const fsBtn = root.querySelector('.fl-fs');
  hideBtn?.addEventListener('click', () => {
    const lit = document.body.classList.toggle('fl-hidepanel');
    hideBtn.classList.toggle('on', lit);
    if (lit) { document.body.classList.remove('fl-fullscreen'); fsBtn?.classList.remove('on'); }
  });
  fsBtn?.addEventListener('click', () => {
    const lit = document.body.classList.toggle('fl-fullscreen');
    fsBtn.classList.toggle('on', lit);
    if (lit) { document.body.classList.remove('fl-hidepanel'); hideBtn?.classList.remove('on'); }
  });

  // ── FPS: THE CAMERA PUTS ITS FEET DOWN ──────────────────────────────────────
  //
  // The one button in this row that is about the CAMERA rather than about the screen. `freecam.js`
  // has had a standing mode since the telescopes shipped and nothing could reach it without being
  // a vantage: feet on the ground, W walking on the level instead of carrying the lens, no orbit,
  // no roll, no up-down.
  //
  // ⚠ UNLEASHED, WHICH IS THE ONE THING THAT MAKES IT A PERSON RATHER THAN A TELESCOPE. A vantage
  // takes `STAND_LEASH` because it IS a place — half a deck's width, and walking off it would mean
  // it was never standing anywhere. This is somebody on foot in a city, so the tether is 0 and the
  // clamp in `place` is inert by arithmetic rather than by a guard.
  //
  // ⚠ AND `freeCam.standing` IS NOT `st.stand`. The second is "this view was OPENED as a vantage",
  // which decides the label, the recentre branch, the detail tune and whether the mount re-asserts
  // the eye height every frame; the first is "the camera's feet are down right now". Reading one
  // for the other puts a telescope's mount under a walking camera, which pins it to the deck it is
  // nowhere near.
  const fpsBtn = root.querySelector('.fl-fps');
  function paintFps() {
    if (!fpsBtn) return;
    const up = freeCam.standing;
    fpsBtn.textContent = up ? 'FLY' : 'FPS';
    fpsBtn.title = up ? 'back to the flying camera' : 'first person — put the camera on its feet and walk';
    fpsBtn.classList.toggle('on', up);
    fpsBtn.setAttribute('aria-pressed', up ? 'true' : 'false');
  }
  paintFps();
  fpsBtn?.addEventListener('click', () => {
    freeCam.setStand(!freeCam.standing, { leash: 0 });
    paintFps();
    paintHint();
  });
  // ⌨ THE KEYBOARD IS THIS VIEW'S WHILE IT IS OPEN. Every key this camera flies on — W/A/S/D, Q/E,
  // the brackets — is an ordinary letter, and the command bar is a text input a few hundred pixels
  // below the picture: a player who has clicked it once is flying nothing and typing "wasd" into
  // the chat box. The cab and the flight sim have taken the keyboard on mount for a long time and
  // this seat never did, which is why it is the one the complaint was about. See seat-keys.js.
  claimSeatKeyboard(root, { label: stand ? 'VIEW' : 'CAMERA' });

  st.teardown = () => {
    endSeatKeyboard(root);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onLetGo);
    document.removeEventListener('visibilitychange', onHidden);
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
  // The page-level layout this view turned on. All three are the PAGE's rather than the pane's, so
  // nothing else takes them down — and a player who closed the camera at ⛶ with the sidebar hidden
  // would be handed a room description with no panels, no log and no command box.
  exitBigScreen();
  setSidebarHidden(false);
  document.body.classList.remove('fl-fullscreen', 'fl-hidepanel');
  window.dispatchEvent(new Event('pane:released'));
  if (s.mount) s.mount.innerHTML = '';
}

// Where the vantage is, in the vocabulary the camera's own x/y are in: a world-tile offset from the
// tile the window is centred on, plus an absolute eye height. A named mount is asked; otherwise the
// vantage's own authored numbers stand, which is right for anything on ground that does not move.
// ⚠ IT MAY ANSWER null — the mount reads the centre cell, and a window whose centre is not what the
// vantage said it was is a window this camera has no business standing in. The caller falls back to
// the flying camera rather than putting the eye somewhere invented.
function standSpot(s, now) {
  const stand = s.stand;
  if (!stand) return null;
  if (stand.mount && MOUNTS[stand.mount]) {
    const R = s.map ? (s.map.length - 1) / 2 : 0;
    const m = MOUNTS[stand.mount](s.map, R, now);
    if (m) return m;
  }
  return stand.eye != null ? { x: stand.x || 0, y: stand.y || 0, z: stand.eye } : null;
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
    /* A pressed rung reads as pressed, the '.on' convention every other corner in this client uses.
       ⚠ The two readouts are SPANs and must never pick this up — 'button.fl-chip' rather than
       '.fl-chip', or a weather chip that happened to be given the class would light like a switch. */
    button.fl-chip.on{ background:rgba(233,241,250,0.90); color:#0a0f16; border-color:rgba(233,241,250,0.95); }
    /* FPS / FLY is a word where its neighbours are glyphs, so it gets a fixed width — otherwise the
       whole row shuffles sideways every time the mode changes and the button you were aiming at has
       moved. Same reason the flight sim's ◎ EXT is padded rather than sized to its text. */
    button.fl-chip.fl-fps{ min-width:34px; text-align:center; }
    .fl-hint{ position:absolute; left:50%; bottom:12px; transform:translateX(-50%); z-index:6;
      font:11px/1 system-ui,sans-serif; letter-spacing:0.6px; color:#dfe6ef; background:rgba(8,11,15,0.62);
      padding:4px 12px; border-radius:11px; border:1px solid rgba(255,255,255,0.16);
      pointer-events:none; white-space:nowrap; transition:opacity .35s linear; }
    /* ── ⚠ THE HINT FADES AND THE BUTTONS DO NOT, WHICH IS THE OPPOSITE OF THE THREE SEATS ──
       In the cab, the cockpit and the wheelhouse the free camera is a MODE: you press O to take it
       off its mount and O to put it back, the vehicle is still there underneath, and the chrome
       going quiet after a few seconds is the reward for composing a shot. Out here the camera is
       never on a mount — this view IS the detached camera — so that timer is not a mode, it is the
       permanent state of the view: two and a half seconds after it opens, the way out, the big
       screen button and both readouts are gone and stay gone.
       ⚠ AND THE ONE THING THAT BRINGS THEM BACK IS THE ONE THING YOU CANNOT SPEND. Waking the
       chrome means moving the mouse, and in here the mouse IS the camera — so you cannot look at
       the row without losing the shot you were lining up, which is exactly when you wanted it.
       Reported as the buttons having disappeared, and they had.
       So the row stays. What the fade was FOR — a picture with nothing on it — is big screen's job
       now, and big screen takes the lot outright rather than hoping nobody breathes on the desk.
       The hint keeps the timer, because it is a paragraph of text across the bottom of the frame
       and it is genuinely read once. */
    body.freecam-idle .fl-hint{ opacity:0; }
    /* ── BIG SCREEN ────────────────────────────────────────────────────────
       Everything but the picture. The chips and the hint fade on the free camera's own timer up
       there; in here they go outright, because the way out of big screen is Esc and the mode
       carries its own line saying so — and O still closes the view from inside it.
       ⚠ AN ALLOW-LIST, the shape the three seats already use, so anything hung on this glass
       later is out of the shot the day it arrives. '.ws-label' is the vantage's own name in the
       corner, which is a caption, and there is no windscreen out here for the A-pillars to be. */
    body.bigscreen .fl-root > *:not(.fl-view){ display:none !important; }
    body.bigscreen .fl-root .ws-label,
    body.bigscreen .fl-root .ws-frame::after{ display:none; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
