// REEL — a two-stage fishing minigame. Something's on the line and fighting.
//
// STAGE 1 — THE CAST: a power gauge whose marker ping-pongs up and down
// (LONG↔SHORT). TAP (button / the tube / Space) to lock it; land inside the
// green STRIKE zone to place a clean cast. A better cast buys a head-start into
// the fight (the creel starts fuller); a weak cast starts you deeper in the
// hole. The bobber then flies out, settles, and is yanked under — FISH ON.
//
// STAGE 2 — THE REEL: a vertical GAFF slides up while you REEL (hold the button
// / the tube / Space) and sinks when you let go; the hooked catch darts up and
// down the water column on its own, a taut line shivering above it as the
// tension climbs. Keep the gaff overlapping the catch to fill the CREEL meter;
// lose the overlap and the LINE tension climbs and the creel bleeds back down.
// Fill the creel before the catch throws the hook (creel empties) → it's landed.
//
// A cosmetic overlay armed server-side by the fishing plugin on a bite (see
// plugins/fishing/index.js → dispatch.js's `fishing_game` route). The win/lose
// result is reported via opts.onResult; the caller fires the real server command
// (`fishresolve`), which is authoritative — it validates the anti-spoof token +
// posture + carried rod, then applies the catch, spawns a hooked monster, or
// snaps the rod. The board weighs the player's real Fishing skill against the
// catch's difficulty: the gap (edge = skill - difficulty) drives the gaff size,
// the strike-zone width, how wildly the catch fights, and how fast the creel
// fills — an outclassed angler faces a genuinely brutal fight, not a cosmetic
// difference. Difficulty also stokes the silhouette: the harder the catch, the
// bigger and darker the shape you're wrestling out of the black water.

import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

let _overlay = null;
let _close = null;
let _state = null;
let _opts = null;
let _raf = 0;
let _lastT = 0;
let _hold = false;
let _listeners = [];
let _timers = [];

// ── Audio ─────────────────────────────────────────────────────────────────
// Cues resolve through window.SFXCatalog by id ('fishing-cast', …); the synth
// defs live in client/shared/sfx-catalog.js so they're editable in the dev
// panel's Sounds tab. Guarded — silent if audio isn't up. Falls back to the
// hololock cues if a fishing cue isn't catalogued yet.
function fsfx(id, fallback) {
  const cat = window.SFXCatalog;
  if (cat && typeof cat.get === 'function' && cat.get(id)) sfx(id);
  else if (fallback) sfx(fallback);
}

// Deferred timers, all tracked so close() can flush them mid-sequence.
function schedule(fn, ms) { const t = setTimeout(fn, ms); _timers.push(t); return t; }
function clearTimers() { for (const t of _timers) clearTimeout(t); _timers = []; }

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('fishing-styles')) return;
  const s = document.createElement('style');
  s.id = 'fishing-styles';
  s.textContent = `
    #fishing-overlay { --fs-accent:#4fe0a0; --mg-accent:#4fe0a0; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,6,7,0.80); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    /* Moulded brine-green chassis — top-lit multi-stop body (matches the ATM #atm-box). */
    #fishing-overlay .fs-panel { width:min(540px,94vw); color:var(--fs-accent);
      background:linear-gradient(180deg, #16302a 0%, #0f231e 7%, #091712 12%, #040d0a 100%);
      padding:14px 16px 16px; animation:fs-boot .3s ease-out; }
    @keyframes fs-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #fishing-overlay .fs-hud { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#7fae99; letter-spacing:1px; flex-wrap:wrap; }
    #fishing-overlay .fs-hud b { color:var(--fs-accent); font-weight:bold; }
    #fishing-overlay .fs-creel-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #fishing-overlay .fs-creel-bar { display:inline-block; width:120px; height:8px; background:#0a1a16; border:1px solid #2b5040; border-radius:3px; overflow:hidden; }
    #fishing-overlay .fs-creel-fill { display:block; height:100%; width:35%; background:#46e05a; transition:width .1s linear, background .2s; }
    #fishing-overlay .fs-bezel { margin:4px 0 2px; }
    #fishing-overlay .fs-screen { background:radial-gradient(130% 130% at 50% 42%, color-mix(in srgb, var(--fs-accent) 11%, #02100b) 55%, #01070a 100%); }
    /* The play area: a tall water column (the tube) with a controllable gaff band
       and the hooked catch drifting inside it. */
    #fishing-overlay .fs-rig { position:relative; z-index:2; display:flex; gap:12px; padding:14px 16px; align-items:stretch; justify-content:center; }
    #fishing-overlay .fs-column { position:relative; width:74px; height:250px; border:1px solid #22463a; border-radius:6px; overflow:hidden; cursor:pointer;
      background:linear-gradient(180deg,#0d2a22 0%,#0a231e 30%,#071b19 62%,#04110f 100%);
      box-shadow:inset 0 2px 6px rgba(0,0,0,0.7), inset 0 0 22px color-mix(in srgb, var(--fs-accent) 12%, transparent); }
    /* Drifting caustic light bands in the water. */
    #fishing-overlay .fs-column::before { content:''; position:absolute; inset:-40% 0; pointer-events:none;
      background:repeating-linear-gradient(0deg, transparent 0 16px, color-mix(in srgb, var(--fs-accent) 8%, transparent) 16px 18px);
      animation:fs-caustic 5.5s linear infinite; }
    @keyframes fs-caustic { 0%{transform:translateY(0)} 100%{transform:translateY(34px)} }
    /* Rippling surface skin at the top of the column — the waterline. */
    #fishing-overlay .fs-surface { position:absolute; top:0; left:0; right:0; height:16px; pointer-events:none; z-index:3;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 30%, transparent), transparent);
      border-bottom:1px solid color-mix(in srgb, var(--fs-accent) 34%, transparent); opacity:0.7;
      -webkit-mask:repeating-linear-gradient(90deg,#000 0 6px, transparent 6px 8px); mask:repeating-linear-gradient(90deg,#000 0 6px, transparent 6px 8px);
      animation:fs-surface 3.4s linear infinite; }
    @keyframes fs-surface { 0%{background-position:0 0} 100%{background-position:16px 0} }
    /* Rising bubbles — depth ambience under the surface. */
    #fishing-overlay .fs-bubble { position:absolute; bottom:-8px; width:4px; height:4px; border-radius:50%; pointer-events:none; z-index:2;
      background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6), color-mix(in srgb, var(--fs-accent) 45%, transparent) 70%, transparent);
      opacity:0; animation:fs-bubble 4.2s linear infinite; }
    @keyframes fs-bubble { 0%{transform:translateY(0) scale(.6);opacity:0} 12%{opacity:.65} 88%{opacity:.5} 100%{transform:translateY(-250px) scale(1.1);opacity:0} }
    /* Cast stage — a power gauge the angler tap-locks to place the cast. */
    #fishing-overlay .fs-castmeter { position:absolute; left:50%; top:22px; bottom:22px; width:18px; margin-left:-9px; z-index:6;
      border:1px solid #2b5040; border-radius:9px; overflow:hidden; opacity:0; transition:opacity .3s;
      background:linear-gradient(180deg,#0a221c,#061a17); box-shadow:inset 0 2px 6px rgba(0,0,0,0.7); }
    #fishing-overlay .fs-castmeter.fs-live { opacity:1; }
    #fishing-overlay .fs-castmeter.fs-done { opacity:0; }
    #fishing-overlay .fs-castband { position:absolute; left:0; right:0;
      background:linear-gradient(180deg, rgba(70,224,90,0.5), rgba(70,224,90,0.26));
      border-top:1px solid #46e05a; border-bottom:1px solid #46e05a;
      box-shadow:0 0 12px rgba(70,224,90,0.4), inset 0 0 6px rgba(70,224,90,0.3); }
    #fishing-overlay .fs-castmeter.fs-hit .fs-castband { animation:fs-castflash .5s ease-out; }
    @keyframes fs-castflash { 0%{filter:brightness(2.4)} 100%{filter:brightness(1)} }
    #fishing-overlay .fs-castmarker { position:absolute; left:-4px; right:-4px; height:3px; margin-top:-1.5px; border-radius:2px;
      background:#eafff4; box-shadow:0 0 8px var(--fs-accent), 0 0 3px #fff; }
    #fishing-overlay .fs-castcap { position:absolute; left:50%; transform:translateX(-50%); z-index:6; font-size:7px; letter-spacing:1px; color:#7fae99; pointer-events:none; opacity:0; transition:opacity .3s; }
    #fishing-overlay .fs-castcap.fs-live { opacity:0.75; }
    #fishing-overlay .fs-castcap-top { top:7px; } #fishing-overlay .fs-castcap-bot { bottom:7px; }
    /* Cast-off dressing: the pay-out line and a bobber that drops, settles, dips. */
    #fishing-overlay .fs-castline { position:absolute; left:50%; top:0; width:1px; margin-left:-0.5px; z-index:4; pointer-events:none; height:0;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 70%, transparent), color-mix(in srgb, var(--fs-accent) 30%, transparent));
      transition:height .5s cubic-bezier(.3,.9,.3,1); }
    #fishing-overlay .fs-bobber { position:absolute; left:50%; top:-14px; width:12px; height:12px; margin-left:-6px; z-index:5; pointer-events:none;
      border-radius:50%; background:radial-gradient(circle at 35% 28%, #ff7a6b 0 40%, #d43a2c 55%, #7c1c15 100%);
      box-shadow:0 0 8px color-mix(in srgb, var(--fs-accent) 40%, transparent), inset 0 -2px 3px rgba(0,0,0,0.5);
      opacity:0; transition:top .5s cubic-bezier(.3,.9,.3,1), opacity .2s; }
    #fishing-overlay .fs-bobber.fs-bob { animation:fs-bob 1.1s ease-in-out infinite; }
    @keyframes fs-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(3px)} }
    /* A ripple ring where the bobber breaks the surface. */
    #fishing-overlay .fs-ripple { position:absolute; left:50%; width:10px; height:6px; margin-left:-5px; z-index:4; pointer-events:none;
      border:1px solid color-mix(in srgb, var(--fs-accent) 60%, transparent); border-radius:50%; opacity:0; transform:scale(.4); }
    #fishing-overlay .fs-ripple.fs-go { animation:fs-ripple .9s ease-out; }
    @keyframes fs-ripple { 0%{opacity:.8;transform:scale(.35)} 100%{opacity:0;transform:scale(3.4)} }
    /* The taut hooked line during the fight — runs from the surface down to the
       catch and shivers when the tension bites. */
    #fishing-overlay .fs-line { position:absolute; left:50%; top:0; width:1px; margin-left:-0.5px; z-index:2; pointer-events:none; height:0; opacity:0;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 65%, transparent), color-mix(in srgb, var(--fs-accent) 22%, transparent));
      transition:opacity .3s; }
    #fishing-overlay .fs-line.fs-strain { animation:fs-strain .09s linear infinite; background:linear-gradient(180deg,#ff6a4a,#ffb23e); }
    @keyframes fs-strain { 0%,100%{transform:translateX(0)} 33%{transform:translateX(0.9px)} 66%{transform:translateX(-0.9px)} }
    /* The gaff — the band you drive up/down to bracket the catch. */
    #fishing-overlay .fs-gaff { position:absolute; left:3px; right:3px; border-radius:5px; z-index:3; opacity:0;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 46%, transparent), color-mix(in srgb, var(--fs-accent) 20%, transparent));
      border:1px solid var(--fs-accent);
      box-shadow:0 0 12px color-mix(in srgb, var(--fs-accent) 45%, transparent), inset 0 0 8px color-mix(in srgb, var(--fs-accent) 30%, transparent);
      transition:background .12s, box-shadow .12s, opacity .4s; }
    /* Serrated inner lip so the band reads as a gaff/net, not a plain bar. */
    #fishing-overlay .fs-gaff::before, #fishing-overlay .fs-gaff::after { content:''; position:absolute; left:2px; right:2px; height:3px;
      background:repeating-linear-gradient(90deg, var(--fs-accent) 0 2px, transparent 2px 5px); opacity:0.55; }
    #fishing-overlay .fs-gaff::before { top:1px; } #fishing-overlay .fs-gaff::after { bottom:1px; }
    #fishing-overlay .fs-gaff.fs-locked { background:linear-gradient(180deg, rgba(70,224,90,0.5), rgba(70,224,90,0.24)); border-color:#46e05a; box-shadow:0 0 16px rgba(70,224,90,0.5), inset 0 0 8px rgba(70,224,90,0.35); }
    /* The hooked catch — a silhouette that fights up and down the column. Its
       scale/darkness ride --fs-menace (set from the catch difficulty). */
    #fishing-overlay .fs-fish { position:absolute; left:50%; width:44px; height:22px; margin-left:-22px; margin-top:-11px; pointer-events:none; z-index:4; opacity:0;
      transform:scale(var(--fs-menace,1)); transform-origin:center; transition:opacity .4s;
      color:#081611; filter:drop-shadow(0 0 6px color-mix(in srgb, var(--fs-accent) 60%, transparent)); }
    #fishing-overlay .fs-fish.fs-hooked { color:#0a0705; filter:drop-shadow(0 0 9px color-mix(in srgb, var(--fs-accent) 85%, transparent)); }
    #fishing-overlay .fs-fish svg { display:block; width:100%; height:100%; overflow:visible; }
    #fishing-overlay .fs-fish .fs-tail { transform-box:fill-box; transform-origin:left center; animation:fs-tail .62s ease-in-out infinite alternate; }
    #fishing-overlay .fs-fish.fs-hooked .fs-tail { animation-duration:.24s; }
    @keyframes fs-tail { from{transform:rotate(-16deg)} to{transform:rotate(16deg)} }
    /* Tension rope on the right of the column. */
    #fishing-overlay .fs-tension { position:relative; width:12px; height:250px; border:1px solid #22463a; border-radius:6px; overflow:hidden; background:#081712; }
    #fishing-overlay .fs-tension-fill { position:absolute; left:0; right:0; bottom:0; height:0%; background:linear-gradient(180deg,#ff4a5b,#ffb23e); transition:height .12s linear, opacity .2s; opacity:0.85; }
    #fishing-overlay .fs-tension-label { position:absolute; top:4px; left:50%; transform:translateX(-50%); font-size:7px; letter-spacing:1px; color:#7fae99; writing-mode:vertical-rl; }
    /* Big centred beat when the bite lands. */
    #fishing-overlay .fs-onbanner { position:absolute; inset:0; z-index:7; display:flex; align-items:center; justify-content:center; pointer-events:none;
      font-size:20px; font-weight:bold; letter-spacing:3px; color:#fff; text-shadow:0 0 16px var(--fs-accent), 0 0 4px #fff; opacity:0; }
    #fishing-overlay .fs-onbanner.fs-go { animation:fs-onbanner 1s ease-out; }
    @keyframes fs-onbanner { 0%{opacity:0;transform:scale(.7)} 25%{opacity:1;transform:scale(1.08)} 70%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1)} }
    #fishing-overlay .fs-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #fishing-overlay .fs-status .fs-win { color:#46e05a; }
    #fishing-overlay .fs-status .fs-lose { color:#ff4a5b; }
    #fishing-overlay .fs-actions { display:flex; gap:8px; margin-top:8px; }
    #fishing-overlay .fs-btn { flex:1; padding:11px 6px; background:#0a1a16; color:#8fc4ab; border:1px solid #2b5040;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; user-select:none; -webkit-user-select:none; touch-action:none; }
    #fishing-overlay .fs-btn-reel.fs-cast { color:#040d0a; background:var(--fs-accent); border-color:var(--fs-accent); animation:fs-castpulse 1s ease-in-out infinite; }
    @keyframes fs-castpulse { 0%,100%{box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5)} 50%{box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5), 0 0 14px var(--fs-accent)} }
    #fishing-overlay .fs-btn-reel.fs-down { color:#040d0a; background:var(--fs-accent); border-color:var(--fs-accent); box-shadow:inset 0 2px 4px rgba(0,0,0,0.4); }
    #fishing-overlay .fs-btn[disabled] { opacity:0.45; cursor:default; }
    #fishing-overlay .fs-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
  `;
  document.head.appendChild(s);
}

// A meaner, more detailed predator silhouette: forked tail (wiggles on its own),
// dorsal + anal fins, a gill slit, a lit eye, and a hint of jaw. Faces left,
// into the pull. currentColor is the dark body; the accent lights the eye.
const FISH_SVG = `<svg viewBox="0 0 44 22" xmlns="http://www.w3.org/2000/svg">` +
  `<g class="fs-tail"><path fill="currentColor" d="M38 11 L44 4 Q41 11 44 18 Z"/></g>` +
  `<path fill="currentColor" d="M2 11 Q9 4 20 5 Q32 6 39 11 Q32 16 20 17 Q9 18 2 11 Z"/>` +
  `<path fill="currentColor" d="M17 5 L24 -1 L27 6 Z"/>` +
  `<path fill="currentColor" d="M18 16 L23 21 L27 16 Z"/>` +
  `<path fill="currentColor" d="M2 11 L8 8 Q6 11 8 14 Z"/>` +
  `<path fill="none" stroke="color-mix(in srgb, var(--fs-accent) 40%, transparent)" stroke-width="1" d="M11 7 Q9 11 11 15"/>` +
  `<circle cx="7" cy="10.4" r="1.7" fill="var(--fs-accent)"/>` +
  `<circle cx="7" cy="10.4" r="0.7" fill="#02110b"/>` +
  `<path fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" d="M2.4 12.4 Q5 13.6 8 13"/>` +
  `</svg>`;

// ── Generation ──────────────────────────────────────────────────────────────
function generate(skill, difficulty) {
  const edge = skill - difficulty;
  // Cast strike zone: centred somewhere on the gauge (fresh each cast), its
  // half-width widened by skill and pinched by a tough catch.
  const hw = clampNum(0.13 + edge * 0.012, 0.075, 0.26);
  const centre = clampNum(0.42 + Math.random() * 0.36, hw + 0.05, 1 - hw - 0.05);
  return {
    phase: 'cast',   // 'cast' (gauge stage) → 'fight' (reel physics)
    // ── Cast stage ──
    castMarker: 0, castDir: 1,
    castSpeed: clampNum(0.95 + difficulty * 0.05, 0.95, 1.9), // gauge units/sec — twitchier for tough catches
    castBand: { lo: centre - hw, hi: centre + hw },
    castLocked: false, castQuality: null,
    // ── Fight stage. Positions are 0 (top) .. 1 (bottom) of the column. ──
    gaff: 0.5, gaffVel: 0,
    gaffH: clampNum(0.22 + edge * 0.02, 0.11, 0.40),   // gaff band height (fraction) — skill widens it
    fish: 0.5, fishTarget: 0.5, fishTimer: 0,
    fishSpeed: clampNum(0.4 + difficulty * 0.055 - skill * 0.02, 0.22, 1.5), // how fast it chases its target
    dartChance: clampNum(0.4 + difficulty * 0.06 - skill * 0.03, 0.2, 1.6),  // darts/sec toward an extreme
    fillRate: clampNum(0.44 + edge * 0.03, 0.26, 0.85), // creel gain/sec while bracketed
    drainRate: clampNum(0.30 - edge * 0.02, 0.14, 0.6), // creel loss/sec while not
    menace: clampNum(0.82 + difficulty * 0.05, 0.82, 1.5), // silhouette scale — bigger = scarier catch
    creel: 0.35,     // progress toward landing (win at 1, snap at 0) — set by the cast
    tension: 0,      // strain readout (drives the deck LEDs) — climbs off-bracket
    over: false, won: false,
  };
}

// How the cast quality seeds the fight: a clean strike starts the creel fuller.
const CAST_CREEL = { perfect: 0.55, good: 0.42, weak: 0.24 };

// ── Physics ─────────────────────────────────────────────────────────────────
const LIFT = 1.9, GRAVITY = 1.25, DAMP = 0.86;
function stepGaffStable(s, dt) {
  const accel = _hold ? -LIFT : GRAVITY;         // up is negative
  s.gaffVel = (s.gaffVel + accel * dt) * DAMP;
  let np = s.gaff + s.gaffVel * dt;
  const lo = s.gaffH / 2, hi = 1 - s.gaffH / 2;
  if (np < lo) { np = lo; s.gaffVel = 0; }
  if (np > hi) { np = hi; s.gaffVel = 0; }
  s.gaff = np;
}

function stepFish(s, dt) {
  s.fishTimer -= dt;
  if (s.fishTimer <= 0) {
    // Pick a new target; occasionally dart to an extreme (the fight).
    if (Math.random() < s.dartChance * 0.5) s.fishTarget = Math.random() < 0.5 ? 0.08 : 0.92;
    else s.fishTarget = 0.12 + Math.random() * 0.76;
    s.fishTimer = 0.35 + Math.random() * 0.9 / Math.max(0.4, s.dartChance);
  }
  const dir = Math.sign(s.fishTarget - s.fish);
  s.fish = clampNum(s.fish + dir * s.fishSpeed * dt, 0.05, 0.95);
}

// The gauge marker ping-pongs between the ends.
function stepCast(s, dt) {
  s.castMarker += s.castDir * s.castSpeed * dt;
  if (s.castMarker >= 1) { s.castMarker = 1; s.castDir = -1; }
  if (s.castMarker <= 0) { s.castMarker = 0; s.castDir = 1; }
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  const col = _overlay.querySelector('#fs-column');
  const gaff = _overlay.querySelector('#fs-gaff');
  const fish = _overlay.querySelector('#fs-fish');
  if (!col || !gaff || !fish) return;
  const h = col.clientHeight;
  const gh = _state.gaffH * h;
  gaff.style.height = `${gh}px`;
  gaff.style.top = `${_state.gaff * h - gh / 2}px`;
  fish.style.top = `${_state.fish * h}px`;
  const bracketed = Math.abs(_state.fish - _state.gaff) <= _state.gaffH / 2;
  gaff.classList.toggle('fs-locked', bracketed);
  fish.classList.toggle('fs-hooked', bracketed);

  // The taut line trails the catch and shivers as tension bites.
  const line = _overlay.querySelector('#fs-line');
  if (line) { line.style.height = `${_state.fish * h}px`; line.classList.toggle('fs-strain', _state.tension > 0.5); }

  const creel = _overlay.querySelector('#fs-creel-fill');
  const pct = Math.round(_state.creel * 100);
  creel.style.width = `${pct}%`;
  creel.style.background = pct > 66 ? '#46e05a' : pct > 33 ? '#ffb23e' : '#ff4a5b';

  const tfill = _overlay.querySelector('#fs-tension-fill');
  if (tfill) tfill.style.height = `${Math.round(_state.tension * 100)}%`;
}

// Position the gauge band (static) and the sweeping marker.
function renderCast(bandToo) {
  const meter = _overlay.querySelector('#fs-castmeter');
  if (!meter) return;
  const H = meter.clientHeight;
  if (bandToo) {
    const band = _overlay.querySelector('#fs-castband');
    if (band) { band.style.top = `${(1 - _state.castBand.hi) * H}px`; band.style.height = `${(_state.castBand.hi - _state.castBand.lo) * H}px`; }
  }
  const marker = _overlay.querySelector('#fs-castmarker');
  if (marker) marker.style.top = `${(1 - _state.castMarker) * H}px`;
}

function setStatus(html) { const el = _overlay.querySelector('#fs-status'); if (el) el.innerHTML = html; }

// ── Stage 1: the cast ─────────────────────────────────────────────────────────
function startCast() {
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.add('fs-live');
  _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.add('fs-live'));
  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.textContent = 'Cast'; btn.classList.add('fs-cast'); btn.removeAttribute('disabled'); }
  renderCast(true);
  setStatus('<span style="color:#7fae99">TAP to cast — land the marker in the green STRIKE zone.</span>');
  fsfx('fishing-cast', 'hololock-entry');
  // Safety net: auto-cast if the player never taps (keeps the overlay from stalling).
  schedule(() => { if (_state && _state.phase === 'cast' && !_state.castLocked) lockCast(); }, 6000);
  _lastT = performance.now();
  _raf = requestAnimationFrame(castTick);
}

function castTick(t) {
  if (!_state || _state.phase !== 'cast' || _state.castLocked) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;
  stepCast(_state, dt);
  renderCast(false);
  _raf = requestAnimationFrame(castTick);
}

function lockCast() {
  if (!_state || _state.phase !== 'cast' || _state.castLocked) return;
  _state.castLocked = true;
  cancelAnimationFrame(_raf); _raf = 0;

  const m = _state.castMarker;
  const { lo, hi } = _state.castBand;
  let quality;
  if (m >= lo && m <= hi) quality = 'perfect';
  else if (m >= lo - 0.13 && m <= hi + 0.13) quality = 'good';
  else quality = 'weak';
  _state.castQuality = quality;
  _state.creel = CAST_CREEL[quality];

  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.classList.remove('fs-cast'); btn.setAttribute('disabled', ''); }
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter && quality === 'perfect') meter.classList.add('fs-hit');
  fsfx(quality === 'weak' ? 'fishing-splash' : 'fishing-cast', 'hololock-tick');
  const label = quality === 'perfect'
    ? '<span style="color:#46e05a">◇ PERFECT CAST — right on the feeding line.</span>'
    : quality === 'good'
      ? '<span style="color:#ffb23e">Good cast — close to the mark.</span>'
      : '<span style="color:#ff7a6b">Sloppy cast — it slaps down short.</span>';
  setStatus(label);

  // Fade the gauge, then fly the bobber out and hand off to the fight.
  schedule(() => { if (meter) { meter.classList.remove('fs-live'); meter.classList.add('fs-done'); } _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.remove('fs-live')); }, 250);
  schedule(() => runCastSplash(startFight), 420);
}

// The bobber pays out, settles, then is yanked under — the bite lands.
function runCastSplash(onDone) {
  const line = _overlay.querySelector('#fs-castline');
  const bobber = _overlay.querySelector('#fs-bobber');
  const ripple = _overlay.querySelector('#fs-ripple');
  const banner = _overlay.querySelector('#fs-onbanner');
  const col = _overlay.querySelector('#fs-column');
  const h = col ? col.clientHeight : 250;
  const restY = Math.round(h * 0.42);

  if (bobber) { bobber.style.opacity = '1'; }
  void (bobber && bobber.offsetHeight);
  if (line) line.style.height = `${restY + 6}px`;
  if (bobber) bobber.style.top = `${restY}px`;

  schedule(() => {
    fsfx('fishing-splash', 'hololock-tick');
    if (ripple) { ripple.style.top = `${restY + 4}px`; ripple.classList.remove('fs-go'); void ripple.offsetHeight; ripple.classList.add('fs-go'); }
    if (bobber) bobber.classList.add('fs-bob');
    setStatus('<span style="color:#7fae99">The float settles on the black water&hellip;</span>');
  }, 520);

  schedule(() => {
    if (bobber) { bobber.classList.remove('fs-bob'); bobber.style.top = `${Math.round(h * 0.6)}px`; }
    if (line) line.style.height = `${Math.round(h * 0.6)}px`;
    if (ripple) { ripple.classList.remove('fs-go'); void ripple.offsetHeight; ripple.classList.add('fs-go'); }
    if (banner) { banner.textContent = 'FISH ON!'; banner.classList.add('fs-go'); }
    fsfx('fishing-bite', 'hololock-win');
  }, 1180);

  schedule(() => {
    if (line) line.style.opacity = '0';
    if (bobber) bobber.style.opacity = '0';
    onDone();
  }, 1680);
}

// ── Stage 2: the reel ─────────────────────────────────────────────────────────
function tick(t) {
  if (!_state || _state.over || _state.phase !== 'fight') return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;

  stepGaffStable(_state, dt);
  stepFish(_state, dt);

  const bracketed = Math.abs(_state.fish - _state.gaff) <= _state.gaffH / 2;
  if (bracketed) {
    _state.creel = clampNum(_state.creel + _state.fillRate * dt, 0, 1);
    _state.tension = clampNum(_state.tension - 1.4 * dt, 0, 1);
  } else {
    _state.creel = clampNum(_state.creel - _state.drainRate * dt, 0, 1);
    _state.tension = clampNum(_state.tension + 0.9 * dt, 0, 1);
  }

  render();
  setDeckLevel(_overlay, _state.tension);

  if (_state.creel >= 1) { finish(true); return; }
  if (_state.creel <= 0) { finish(false); return; }
  _raf = requestAnimationFrame(tick);
}

function startFight() {
  if (!_state || _state.over) return;
  _state.phase = 'fight';
  const gaff = _overlay.querySelector('#fs-gaff');
  const fish = _overlay.querySelector('#fs-fish');
  const line = _overlay.querySelector('#fs-line');
  if (gaff) gaff.style.opacity = '1';
  if (fish) fish.style.opacity = '1';
  if (line) line.style.opacity = '1';
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  if (reelBtn) { reelBtn.textContent = 'Reel In ␣'; reelBtn.removeAttribute('disabled'); }
  render();
  setStatus('<span style="color:#7fae99">HOLD to reel the gaff up over the catch. Bracket it to fill the CREEL — mind the TENSION.</span>');
  _lastT = performance.now();
  _raf = requestAnimationFrame(tick);
}

function finish(won) {
  if (_state.over) return;
  _state.over = true; _state.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  fsfx(won ? 'fishing-land' : 'fishing-snap', won ? 'hololock-win' : 'hololock-lose');
  setStatus(won
    ? '<span class="fs-win">◇ LANDED — it\'s yours.</span>'
    : '<span class="fs-lose">✕ LINE SNAPPED — it threw the hook.</span>');
  const cb = _opts?.onResult;
  schedule(() => { close(); if (cb) cb({ won }); }, 1100);
}

// ── Input wiring ───────────────────────────────────────────────────────────────
// One primary input drives both stages: during the cast it locks the gauge,
// during the fight it reels the gaff up (hold).
function primaryDown() {
  if (!_state) return;
  if (_state.phase === 'cast') { lockCast(); return; }
  setHold(true);
}
function setHold(on) {
  if (on && (!_state || _state.phase !== 'fight')) return;
  _hold = on;
  const btn = _overlay?.querySelector('.fs-btn-reel');
  if (btn) btn.classList.toggle('fs-down', on);
}
function addListener(target, type, fn, opts) { target.addEventListener(type, fn, opts); _listeners.push([target, type, fn, opts]); }
function clearListeners() { for (const [t, ty, fn, o] of _listeners) t.removeEventListener(ty, fn, o); _listeners = []; }

// ── Public API ────────────────────────────────────────────────────────────────
export function openFishing(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, ...opts };
  const bubbles = [
    '<span class="fs-bubble" style="left:24%;animation-delay:0s"></span>',
    '<span class="fs-bubble" style="left:58%;animation-delay:1.5s"></span>',
    '<span class="fs-bubble" style="left:40%;animation-delay:2.8s"></span>',
    '<span class="fs-bubble" style="left:72%;animation-delay:3.6s"></span>',
  ].join('');
  const html =
    `<div class="fs-panel mg-chassis">
      ${deviceHeader('&#127907;', 'REEL', 'ON THE LINE &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="fs-hud">
        <span>DEPTH <b>&#8597;</b></span>
        <span class="fs-creel-wrap">CREEL <span class="fs-creel-bar"><span class="fs-creel-fill" id="fs-creel-fill"></span></span></span>
      </div>
      <div class="fs-bezel mg-bezel">${bezelScrews()}<div class="fs-screen mg-screen" style="--mg-sweep-h:280px">
        <div class="fs-rig">
          <div class="fs-column" id="fs-column">
            <div class="fs-surface"></div>
            ${bubbles}
            <div class="fs-castcap fs-castcap-top">LONG</div>
            <div class="fs-castcap fs-castcap-bot">SHORT</div>
            <div class="fs-castmeter" id="fs-castmeter"><div class="fs-castband" id="fs-castband"></div><div class="fs-castmarker" id="fs-castmarker"></div></div>
            <div class="fs-line" id="fs-line"></div>
            <div class="fs-castline" id="fs-castline"></div>
            <div class="fs-gaff" id="fs-gaff"></div>
            <div class="fs-fish" id="fs-fish">${FISH_SVG}</div>
            <div class="fs-ripple" id="fs-ripple"></div>
            <div class="fs-bobber" id="fs-bobber"></div>
            <div class="fs-onbanner" id="fs-onbanner"></div>
          </div>
          <div class="fs-tension"><div class="fs-tension-fill" id="fs-tension-fill"></div><span class="fs-tension-label">TENSION</span></div>
        </div>
        ${crtOverlays()}
      </div></div>
      ${deckStrip('DRAG BUS', 'TENSION')}
      <div class="fs-status" id="fs-status"></div>
      <div class="fs-actions">
        <button class="fs-btn fs-btn-reel">Cast</button>
        <button class="fs-btn fs-btn-abort">Cut Line</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'fishing-overlay',
    html,
    closeOnBackdrop: false,   // don't let a stray click abandon an active fight
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } clearTimers(); clearListeners(); _hold = false; _state = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.fs-btn-abort').addEventListener('click', close);

  // Primary input: the button, the water column, and Space. In the cast stage
  // it locks the gauge; in the fight it holds the gaff up.
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  const column = _overlay.querySelector('#fs-column');
  const down = (e) => { e.preventDefault(); primaryDown(); };
  const up = () => setHold(false);
  addListener(reelBtn, 'pointerdown', down);
  addListener(column, 'pointerdown', down);
  addListener(window, 'pointerup', up);
  addListener(window, 'pointercancel', up);
  addListener(window, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); primaryDown(); } });
  addListener(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setHold(false); } });

  window.AudioEngine?.init?.();

  _state = generate(_opts.skill, _opts.difficulty);
  const fishEl = _overlay.querySelector('#fs-fish');
  if (fishEl) fishEl.style.setProperty('--fs-menace', String(_state.menace));
  render();
  startCast();
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
