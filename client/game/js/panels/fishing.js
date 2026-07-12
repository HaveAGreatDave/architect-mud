// REEL — a two-stage fishing minigame. First you place the cast, then you fight
// whatever takes it.
//
// STAGE 1 — THE CAST: pick your water. A horizontal AIM tick sweeps left↔right
// across the surface — TAP (button / the tube / Space) to lock the angle, and
// keep HOLDING to charge a vertical POWER meter (SHALLOW↔DEEP). RELEASE to fire.
// Power sets how far out / how deep the line lands; angle sets which lane it
// drops into. Where you cast decides what's on the line: deep water hides the
// better catches, while angling off the straight line raises the odds of the
// off-line specials. The cast (power + angle) is reported to the server via
// opts.onCast; the server picks the catch from that and arms the fight (see
// dispatch.js's `fishing_fight` route → armFishFight). A shallow cast also buys
// a fuller CREEL head-start into the fight — deep water is high risk, high reward.
//
// STAGE 2 — THE REEL: a vertical GAFF slides up while you REEL (hold the button
// / the tube / Space) and sinks when you let go; the hooked catch darts up and
// down the water column on its own, a taut line shivering above it as the
// tension climbs. Keep the gaff overlapping the catch to fill the CREEL meter;
// lose the overlap and the LINE tension climbs and the creel bleeds back down.
// Fill the creel before the catch throws the hook (creel empties) → it's landed.
//
// A cosmetic overlay armed server-side by the fishing plugin on a bite (see
// plugins/fishing/index.js). The win/lose result is reported via opts.onResult;
// the caller fires the real server command (`fishresolve`), which is
// authoritative — it validates the anti-spoof token + posture + carried rod,
// then applies the catch, spawns a hooked monster, or snaps the rod. The board
// weighs the player's real Fishing skill against the catch's difficulty: the gap
// (edge = skill - difficulty) drives the gaff size, how wildly the catch fights,
// and how fast the creel fills — an outclassed angler faces a genuinely brutal
// fight. Difficulty also stokes the silhouette: the harder the catch, the bigger
// and darker the shape you're wrestling out of the black water.

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
    #fishing-overlay .fs-panel { width:min(860px,96vw); color:var(--fs-accent);
      background:linear-gradient(180deg, #16302a 0%, #0f231e 7%, #091712 12%, #040d0a 100%);
      padding:16px 20px 18px; animation:fs-boot .3s ease-out; }
    @keyframes fs-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #fishing-overlay .fs-hud { display:flex; gap:12px; align-items:center; padding:8px 2px; font-size:12px; color:#7fae99; letter-spacing:1px; flex-wrap:wrap; }
    #fishing-overlay .fs-hud b { color:var(--fs-accent); font-weight:bold; }
    /* Phase stepper — AIM › CHARGE › REEL, the active leg lit. */
    #fishing-overlay .fs-phases { display:inline-flex; align-items:center; gap:6px; }
    #fishing-overlay .fs-ph { font-size:10px; letter-spacing:1.5px; color:#4c6a5c; transition:color .2s, text-shadow .2s; }
    #fishing-overlay .fs-ph.on { color:var(--fs-accent); text-shadow:0 0 8px color-mix(in srgb, var(--fs-accent) 60%, transparent); }
    #fishing-overlay .fs-ph.done { color:#6f9a86; }
    #fishing-overlay .fs-ph-sep { font-size:9px; color:#33473d; }
    /* Live readout — the phase's current value (lane / depth / status). */
    #fishing-overlay .fs-read { font-size:11px; letter-spacing:1.5px; color:#8fc4ab; min-width:98px;
      padding:2px 8px; border:1px solid #1e3a30; border-radius:3px; background:linear-gradient(180deg,#0b1d18,#071310);
      box-shadow:inset 0 1px 3px rgba(0,0,0,0.6); white-space:nowrap; }
    #fishing-overlay .fs-read b { color:var(--fs-accent); }
    #fishing-overlay .fs-creel-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #fishing-overlay .fs-creel-bar { display:inline-block; width:120px; height:8px; background:#0a1a16; border:1px solid #2b5040; border-radius:3px; overflow:hidden; }
    #fishing-overlay .fs-creel-fill { display:block; height:100%; width:35%; background:#46e05a; transition:width .1s linear, background .2s; }
    #fishing-overlay .fs-bezel { margin:4px 0 2px; }
    #fishing-overlay .fs-screen { background:radial-gradient(130% 130% at 50% 42%, color-mix(in srgb, var(--fs-accent) 11%, #02100b) 55%, #01070a 100%); }
    /* The play area: a tall water shaft (the tube) flanked by a fathom depth scale
       and the tension rope, with a controllable gaff band + the hooked catch inside. */
    #fishing-overlay .fs-rig { position:relative; z-index:2; display:flex; gap:16px; padding:18px 22px; align-items:stretch; justify-content:center; }
    /* Fathom depth scale down the left edge — ticks + numbers, deep at the bottom. */
    #fishing-overlay .fs-scale { position:relative; width:40px; display:flex; flex-direction:column; justify-content:space-between; padding:2px 0; }
    #fishing-overlay .fs-scale-mark { position:relative; font-size:8px; letter-spacing:1px; color:#5f8a78; text-align:right; padding-right:9px; white-space:nowrap; }
    #fishing-overlay .fs-scale-mark::after { content:''; position:absolute; right:0; top:50%; width:6px; height:1px; background:color-mix(in srgb, var(--fs-accent) 55%, transparent); }
    #fishing-overlay .fs-scale-zone { position:relative; flex:1; font-size:7px; letter-spacing:2px; color:#3f5f53; writing-mode:vertical-rl; text-align:center; display:flex; align-items:center; justify-content:center; opacity:0.75; }
    /* The water shaft fills the whole screen — a lit-to-black depth gradient:
       sunlit shallows → murk → the deep. The gaff spans it; the catch fights in it. */
    #fishing-overlay .fs-column { position:relative; flex:1; min-width:0; min-height:420px; border:1px solid #22463a; border-radius:8px; overflow:hidden; cursor:pointer;
      background:linear-gradient(180deg,#164439 0%,#0d2c24 22%,#0a231e 45%,#061713 70%,#030c0a 100%);
      box-shadow:inset 0 2px 8px rgba(0,0,0,0.7), inset 0 0 60px color-mix(in srgb, var(--fs-accent) 12%, transparent); }
    /* Faint zone labels down the right edge, advertising where the good ones live. */
    #fishing-overlay .fs-zonecap { position:absolute; right:4px; z-index:3; font-size:7px; letter-spacing:2px; color:color-mix(in srgb, var(--fs-accent) 34%, transparent); writing-mode:vertical-rl; pointer-events:none; }
    #fishing-overlay .fs-zonecap-1 { top:8%; } #fishing-overlay .fs-zonecap-2 { top:42%; } #fishing-overlay .fs-zonecap-3 { bottom:8%; color:color-mix(in srgb, var(--fs-accent) 22%, #6a4a4a); }
    /* A dim glow at the very bottom — the unseen seabed. */
    #fishing-overlay .fs-column::after { content:''; position:absolute; left:0; right:0; bottom:0; height:22%; z-index:1; pointer-events:none;
      background:radial-gradient(120% 80% at 50% 120%, color-mix(in srgb, var(--fs-accent) 16%, transparent), transparent 70%); }
    /* Drifting caustic light bands in the water. */
    #fishing-overlay .fs-column::before { content:''; position:absolute; inset:-40% 0; pointer-events:none; z-index:1;
      background:repeating-linear-gradient(0deg, transparent 0 22px, color-mix(in srgb, var(--fs-accent) 8%, transparent) 22px 24px);
      animation:fs-caustic 5.5s linear infinite; }
    @keyframes fs-caustic { 0%{transform:translateY(0)} 100%{transform:translateY(46px)} }
    /* Marine snow — slow motes of particulate drifting down through the shaft. */
    #fishing-overlay .fs-snow { position:absolute; top:-6px; width:2px; height:2px; border-radius:50%; z-index:2; pointer-events:none;
      background:color-mix(in srgb, var(--fs-accent) 55%, #cfeee0); opacity:0; animation:fs-snow linear infinite; }
    @keyframes fs-snow { 0%{transform:translateY(0);opacity:0} 10%{opacity:.5} 90%{opacity:.35} 100%{transform:translateY(420px);opacity:0} }
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
      opacity:0; animation:fs-bubble 5s linear infinite; }
    @keyframes fs-bubble { 0%{transform:translateY(0) scale(.6);opacity:0} 12%{opacity:.65} 88%{opacity:.5} 100%{transform:translateY(-420px) scale(1.15);opacity:0} }
    /* Cast stage — a ruled AIM rail across the waterline the tick sweeps along. */
    #fishing-overlay .fs-ruler { position:absolute; top:0; left:0; right:0; height:15px; z-index:5; pointer-events:none; opacity:0; transition:opacity .3s;
      -webkit-mask:linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%); mask:linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%); }
    #fishing-overlay .fs-ruler.fs-live { opacity:0.5; }
    #fishing-overlay .fs-ruler::before { content:''; position:absolute; left:0; right:0; bottom:2px; height:6px;
      background:repeating-linear-gradient(90deg, color-mix(in srgb, var(--fs-accent) 45%, transparent) 0 1px, transparent 1px 9px); }
    /* Cast stage — AIM: a chevron that sweeps the rail; you lock it to pick a lane. */
    #fishing-overlay .fs-aim { position:absolute; top:2px; width:14px; height:13px; margin-left:-7px; z-index:6; pointer-events:none; opacity:0; transition:opacity .3s;
      color:var(--fs-accent); filter:drop-shadow(0 0 5px color-mix(in srgb, var(--fs-accent) 70%, transparent)); }
    #fishing-overlay .fs-aim.fs-live { opacity:0.95; }
    #fishing-overlay .fs-aim.fs-lock { color:#46e05a; filter:drop-shadow(0 0 9px rgba(70,224,90,0.75)); }
    #fishing-overlay .fs-aim svg { display:block; width:100%; height:100%; }
    /* The lane guide — a soft column of light dropping from the aim into the water,
       showing which lane the cast drops into. Greens on lock. */
    #fishing-overlay .fs-lane { position:absolute; top:0; width:11px; margin-left:-5.5px; height:38%; z-index:2; pointer-events:none; opacity:0; transition:opacity .3s, background .2s;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 34%, transparent), transparent);
      -webkit-mask:linear-gradient(180deg,#000,transparent); mask:linear-gradient(180deg,#000,transparent); }
    #fishing-overlay .fs-lane.fs-live { opacity:0.7; }
    #fishing-overlay .fs-lane.fs-lock { background:linear-gradient(180deg, rgba(70,224,90,0.4), transparent); opacity:0.9; }
    /* Cast stage — POWER: a vertical depth gauge (SHALLOW bottom, DEEP top) with
       etched tick marks; it fills while you hold, release height setting the depth. */
    #fishing-overlay .fs-castmeter { position:absolute; left:50%; top:22px; bottom:22px; width:20px; margin-left:-10px; z-index:6;
      border:1px solid #2b5040; border-radius:10px; overflow:hidden; opacity:0; transition:opacity .3s;
      background:linear-gradient(180deg,#0a221c,#061a17); box-shadow:inset 0 2px 6px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.4); }
    #fishing-overlay .fs-castmeter.fs-live { opacity:1; }
    #fishing-overlay .fs-castmeter.fs-done { opacity:0; }
    /* Etched depth ticks up the tube — longer marks at the quarters. */
    #fishing-overlay .fs-castmeter::before { content:''; position:absolute; inset:0; z-index:2; pointer-events:none;
      background:repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0 1px, transparent 1px 5px),
        repeating-linear-gradient(0deg, color-mix(in srgb, var(--fs-accent) 22%, transparent) 0 1px, transparent 1px 25px); }
    /* The charging fill grows up from the bottom; colour cools as it deepens. */
    #fishing-overlay .fs-castfill { position:absolute; left:0; right:0; bottom:0; height:0%; z-index:1; transition:height .05s linear, background .15s;
      background:linear-gradient(180deg, #3ec6ff, #46e05a); box-shadow:0 0 10px color-mix(in srgb, var(--fs-accent) 45%, transparent); }
    /* A bright meniscus line rides the top of the fill — the "current depth" cursor. */
    #fishing-overlay .fs-castfill::after { content:''; position:absolute; left:-1px; right:-1px; top:-1px; height:2px; z-index:3;
      background:#eafff4; box-shadow:0 0 8px #fff, 0 0 14px var(--fs-accent); }
    #fishing-overlay .fs-castmeter.fs-charging { box-shadow:inset 0 2px 6px rgba(0,0,0,0.7), 0 0 14px color-mix(in srgb, var(--fs-accent) 45%, transparent); }
    #fishing-overlay .fs-castcap { position:absolute; left:50%; transform:translateX(-50%); z-index:6; font-size:7px; letter-spacing:1.5px; color:#7fae99; pointer-events:none; opacity:0; transition:opacity .3s; text-shadow:0 0 4px rgba(0,0,0,0.8); }
    #fishing-overlay .fs-castcap.fs-live { opacity:0.8; }
    #fishing-overlay .fs-castcap-top { top:6px; } #fishing-overlay .fs-castcap-bot { bottom:6px; }
    /* Cast-off dressing: the pay-out line and a bobber that drops, settles, dips. */
    #fishing-overlay .fs-castline { position:absolute; left:50%; top:0; width:1px; margin-left:-0.5px; z-index:4; pointer-events:none; height:0;
      background:linear-gradient(180deg, color-mix(in srgb, var(--fs-accent) 70%, transparent), color-mix(in srgb, var(--fs-accent) 30%, transparent));
      transition:height .5s cubic-bezier(.3,.9,.3,1), transform .5s cubic-bezier(.3,.9,.3,1); transform-origin:top center; }
    #fishing-overlay .fs-bobber { position:absolute; left:50%; top:-14px; width:12px; height:12px; margin-left:-6px; z-index:5; pointer-events:none;
      border-radius:50%; background:radial-gradient(circle at 35% 28%, #ff7a6b 0 40%, #d43a2c 55%, #7c1c15 100%);
      box-shadow:0 0 8px color-mix(in srgb, var(--fs-accent) 40%, transparent), inset 0 -2px 3px rgba(0,0,0,0.5);
      opacity:0; transition:top .5s cubic-bezier(.3,.9,.3,1), transform .5s cubic-bezier(.3,.9,.3,1), opacity .2s; }
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
    /* The hook — drops in on the cast (baited, under the float) and rides the line
       down; during the fight it's set in the catch. Rendered where the line ends. */
    #fishing-overlay .fs-hook { position:absolute; left:50%; width:12px; height:18px; margin-left:-6px; z-index:5; pointer-events:none; opacity:0;
      color:#dbeee4; filter:drop-shadow(0 0 3px color-mix(in srgb, var(--fs-accent) 70%, transparent)); transition:opacity .3s, top .5s cubic-bezier(.3,.9,.3,1); }
    #fishing-overlay .fs-hook.fs-set { transition:opacity .3s; }   /* in the fight it snaps to the fish each frame, no lag */
    #fishing-overlay .fs-hook svg { display:block; width:100%; height:100%; overflow:visible; }
    /* A speck of bait on the barb, glowing on the cast. */
    #fishing-overlay .fs-hook .fs-bait { fill:#ff8a5a; filter:drop-shadow(0 0 3px #ff8a5a); }
    #fishing-overlay .fs-hook.fs-set .fs-bait { display:none; }   /* eaten once it's hooked */
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
    #fishing-overlay .fs-fish { position:absolute; left:50%; width:66px; height:33px; margin-left:-33px; margin-top:-16.5px; pointer-events:none; z-index:4; opacity:0;
      transform:scale(var(--fs-menace,1)); transform-origin:center; transition:opacity .4s;
      color:#081611; filter:drop-shadow(0 0 6px color-mix(in srgb, var(--fs-accent) 60%, transparent)); }
    #fishing-overlay .fs-fish.fs-hooked { color:#0a0705; filter:drop-shadow(0 0 9px color-mix(in srgb, var(--fs-accent) 85%, transparent)); }
    #fishing-overlay .fs-fish svg { display:block; width:100%; height:100%; overflow:visible; }
    #fishing-overlay .fs-fish .fs-tail { transform-box:fill-box; transform-origin:left center; animation:fs-tail .62s ease-in-out infinite alternate; }
    #fishing-overlay .fs-fish.fs-hooked .fs-tail { animation-duration:.24s; }
    @keyframes fs-tail { from{transform:rotate(-16deg)} to{transform:rotate(16deg)} }
    /* Tension rope on the right of the column — stretches to the shaft's height. */
    #fishing-overlay .fs-tension { position:relative; width:16px; min-height:400px; border:1px solid #22463a; border-radius:6px; overflow:hidden; background:#081712; box-shadow:inset 0 2px 6px rgba(0,0,0,0.6); }
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

// A little chevron/arrowhead for the aim tick — points down into the water.
const AIM_SVG = `<svg viewBox="0 0 14 13" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="currentColor" d="M7 13 L1 3 Q7 6 13 3 Z"/>` +
  `<rect x="6.2" y="0" width="1.6" height="5" fill="currentColor"/></svg>`;

// A baited J-hook — the eye/shank up the middle, a curl to a barbed point, and a
// speck of bait on the barb (hidden once it's set in a catch). Faces the shank up.
const HOOK_SVG = `<svg viewBox="0 0 12 18" xmlns="http://www.w3.org/2000/svg">` +
  `<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M6 0 V9 A3.4 3.4 0 1 1 2.6 9.4"/>` +
  `<path fill="currentColor" d="M2.6 9.4 L1.1 7.2 L4.4 7.6 Z"/>` +
  `<circle class="fs-bait" cx="2.7" cy="10.2" r="2"/></svg>`;

// ── Generation ──────────────────────────────────────────────────────────────
// The cast stage is generated up front from a nominal difficulty (the server
// doesn't know which catch it is yet — the cast decides). The fight stage is
// generated later, in armFishFight(), once the server has picked the catch and
// sent its real difficulty.
function generateCast(skill, castDifficulty) {
  return {
    phase: 'aim',   // 'aim' → 'charging' → 'await' (server) → 'fight' (reel physics)
    // ── Aim: a tick sweeps left↔right across the surface; lock to pick a lane. ──
    aim: 0.5, aimDir: 1,
    aimSpeed: clampNum(0.72 + castDifficulty * 0.03, 0.72, 1.3), // twitchier aim for a livelier spot
    angle: 0.5,
    // ── Power: charges 0 (shallow) .. 1 (deep) while held, ping-ponging so you
    //    can settle on a depth rather than just mash to the top. ──
    power: 0, powerDir: 1,
    powerSpeed: clampNum(0.62 + castDifficulty * 0.03, 0.62, 1.15),
    castPower: 0,
    // Fight params get merged in later; nothing fight-related is live yet.
    fightReady: false, castAnimDone: false, fightParams: null,
    menace: 1, creel: 0, tension: 0, over: false, won: false,
    gaff: 0.5, gaffVel: 0, gaffH: 0.25, fish: 0.5, fishTarget: 0.5, fishTimer: 0,
  };
}

// The fight board: skill vs. the real catch difficulty. A shallow cast (low
// power) buys a fuller creel head-start — deep water is riskier to work in.
function generateFight(skill, difficulty, castPower) {
  const edge = skill - difficulty;
  return {
    gaff: 0.5, gaffVel: 0,
    gaffH: clampNum(0.22 + edge * 0.02, 0.11, 0.40),   // gaff band height (fraction) — skill widens it
    fish: 0.5, fishTarget: 0.5, fishTimer: 0,
    fishSpeed: clampNum(0.4 + difficulty * 0.055 - skill * 0.02, 0.22, 1.5), // how fast it chases its target
    dartChance: clampNum(0.4 + difficulty * 0.06 - skill * 0.03, 0.2, 1.6),  // darts/sec toward an extreme
    fillRate: clampNum(0.44 + edge * 0.03, 0.26, 0.85), // creel gain/sec while bracketed
    drainRate: clampNum(0.30 - edge * 0.02, 0.14, 0.6), // creel loss/sec while not
    menace: clampNum(0.82 + difficulty * 0.05, 0.82, 1.5), // silhouette scale — bigger = scarier catch
    creel: clampNum(0.45 - castPower * 0.20, 0.22, 0.5),   // shallow casts start fuller
    tension: 0,
    over: false, won: false,
  };
}

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

// Sweep the aim tick left↔right; ping-pong the power meter while charging.
function stepCast(s, dt) {
  if (s.phase === 'aim') {
    s.aim += s.aimDir * s.aimSpeed * dt;
    if (s.aim >= 1) { s.aim = 1; s.aimDir = -1; }
    if (s.aim <= 0) { s.aim = 0; s.aimDir = 1; }
  } else if (s.phase === 'charging') {
    s.power += s.powerDir * s.powerSpeed * dt;
    if (s.power >= 1) { s.power = 1; s.powerDir = -1; }
    if (s.power <= 0) { s.power = 0; s.powerDir = 1; }
  }
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

  // The hook is set in the catch — it rides the fish up and down the column.
  const hook = _overlay.querySelector('#fs-hook');
  if (hook) hook.style.top = `${_state.fish * h - 6}px`;

  const creel = _overlay.querySelector('#fs-creel-fill');
  const pct = Math.round(_state.creel * 100);
  creel.style.width = `${pct}%`;
  creel.style.background = pct > 66 ? '#46e05a' : pct > 33 ? '#ffb23e' : '#ff4a5b';

  const tfill = _overlay.querySelector('#fs-tension-fill');
  if (tfill) tfill.style.height = `${Math.round(_state.tension * 100)}%`;
}

// Position the sweeping aim tick, its lane guide, and the charging power fill.
function renderCast() {
  const col = _overlay.querySelector('#fs-column');
  const w = col ? col.clientWidth : 74;
  const x = (_state.phase === 'charging' ? _state.angle : _state.aim) * w;
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.style.left = `${x}px`;
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.style.left = `${x}px`;
  const fill = _overlay.querySelector('#fs-castfill');
  if (fill) {
    const p = _state.phase === 'charging' ? _state.power : _state.castPower;
    fill.style.height = `${Math.round(p * 100)}%`;
    // Cool as it deepens: warm amber at the shallows → brine-green → cold blue deep.
    fill.style.background = p > 0.66 ? 'linear-gradient(180deg,#3ec6ff,#46e05a)'
      : p > 0.33 ? 'linear-gradient(180deg,#46e05a,#8fe0a0)'
      : 'linear-gradient(180deg,#ffb23e,#ffd07a)';
  }
}

// Depth reading in fathoms-ish feet — pure flavour, tracks the power meter.
function depthFt(power) { return Math.round(power * 60); }

// The phase stepper + live readout in the HUD. `label` overrides the readout.
function renderHud(label) {
  if (!_overlay) return;
  const active = _state?.phase === 'fight' ? 'reel'
    : _state?.phase === 'charging' ? 'charge'
    : _state?.phase === 'aim' ? 'aim'
    : _state?.phase === 'await' ? 'reel' : 'aim';
  const order = ['aim', 'charge', 'reel'];
  const ai = order.indexOf(active);
  _overlay.querySelectorAll('.fs-ph').forEach(el => {
    const i = order.indexOf(el.dataset.ph);
    el.classList.toggle('on', i === ai);
    el.classList.toggle('done', i < ai);
  });
  const read = _overlay.querySelector('#fs-read');
  if (read && label != null) read.innerHTML = label;
}

function setStatus(html) { const el = _overlay.querySelector('#fs-status'); if (el) el.innerHTML = html; }

// ── Stage 1: aim + charge the cast ─────────────────────────────────────────────
function startCast() {
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.add('fs-live');
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.classList.add('fs-live');
  const ruler = _overlay.querySelector('#fs-ruler');
  if (ruler) ruler.classList.add('fs-live');
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.classList.add('fs-live');
  _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.add('fs-live'));
  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.textContent = 'Aim'; btn.classList.add('fs-cast'); btn.removeAttribute('disabled'); }
  renderCast();
  renderHud('PICK YOUR LANE');
  setStatus('<span style="color:#7fae99">TAP to lock your aim, then HOLD to charge — deep water hides the better catches.</span>');
  fsfx('fishing-reel', 'hololock-entry');   // a single reel click — the tackle's ready
  // Safety net: auto-cast with a middling cast if the player never engages.
  schedule(() => { if (_state && _state.phase === 'aim') { beginCharge(); } }, 6000);
  schedule(() => { if (_state && _state.phase === 'charging') fireCast(); }, 7200);
  _lastT = performance.now();
  _raf = requestAnimationFrame(castTick);
}

function castTick(t) {
  if (!_state || (_state.phase !== 'aim' && _state.phase !== 'charging')) return;
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0);
  _lastT = t;
  stepCast(_state, dt);
  renderCast();
  if (_state.phase === 'charging') renderHud(`DEPTH <b>${depthFt(_state.power)} ft</b>`);
  _raf = requestAnimationFrame(castTick);
}

// TAP locks the aim (angle) and hands straight over to charging power.
function beginCharge() {
  if (!_state || _state.phase !== 'aim') return;
  _state.angle = _state.aim;
  _state.phase = 'charging';
  _state.power = 0; _state.powerDir = 1;
  const aim = _overlay.querySelector('#fs-aim');
  if (aim) aim.classList.add('fs-lock');
  const lane = _overlay.querySelector('#fs-lane');
  if (lane) lane.classList.add('fs-lock');
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.add('fs-charging');
  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) btn.textContent = 'Charge…';
  fsfx('fishing-charge', 'hololock-tick');   // reel ratchet winding up
  renderHud('DEPTH <b>0 ft</b>');
  setStatus('<span style="color:#7fae99">RELEASE to cast — the higher you charge, the deeper it lands.</span>');
}

// RELEASE fires the cast: capture power (depth) + angle, report to the server,
// and run the pay-out animation while the server picks the catch.
function fireCast() {
  if (!_state || _state.phase !== 'charging') return;
  _state.castPower = _state.power;
  _state.phase = 'await';
  cancelAnimationFrame(_raf); _raf = 0;
  _hold = false;

  const btn = _overlay.querySelector('.fs-btn-reel');
  if (btn) { btn.classList.remove('fs-cast'); btn.setAttribute('disabled', ''); }
  const meter = _overlay.querySelector('#fs-castmeter');
  if (meter) meter.classList.remove('fs-charging');

  const depth = _state.castPower > 0.66 ? 'deep' : _state.castPower > 0.33 ? 'a fair way out' : 'short';
  renderHud(`CAST <b>${depthFt(_state.castPower)} ft</b>`);
  setStatus(`<span style="color:#8fe0a0">Line away — ${depth}.</span>`);
  fsfx('fishing-cast', 'hololock-tick');   // the whip of the line paying out

  // Report the cast; the server chooses the catch and arms the fight.
  if (_opts?.onCast) _opts.onCast({ power: _state.castPower, angle: _state.angle });

  // Fade the cast furniture, then fly the bobber out to the chosen spot.
  schedule(() => {
    if (meter) { meter.classList.remove('fs-live'); meter.classList.add('fs-done'); }
    _overlay.querySelectorAll('.fs-castcap').forEach(c => c.classList.remove('fs-live'));
    ['#fs-aim', '#fs-ruler', '#fs-lane'].forEach(sel => _overlay.querySelector(sel)?.classList.remove('fs-live', 'fs-lock'));
  }, 220);
  schedule(() => runCastSplash(tryStartFight), 380);

  // Client-side backstop: if the server never arms the fight (it timed the bite
  // out), don't leave the overlay hanging.
  schedule(() => { if (_state && _state.phase === 'await') close(); }, 8000);
}

// The bobber pays out to the cast's lane (angle) and depth (power), settles,
// then is yanked under — the bite lands. onDone hands to the fight.
function runCastSplash(onDone) {
  const line = _overlay.querySelector('#fs-castline');
  const bobber = _overlay.querySelector('#fs-bobber');
  const ripple = _overlay.querySelector('#fs-ripple');
  const banner = _overlay.querySelector('#fs-onbanner');
  const col = _overlay.querySelector('#fs-column');
  const w = col ? col.clientWidth : 74;
  const h = col ? col.clientHeight : 250;
  // Angle → horizontal offset; power → how deep the float rides.
  const dx = Math.round((_state.angle - 0.5) * w * 0.72);
  const restY = Math.round(h * (0.30 + _state.castPower * 0.42));

  const hook = _overlay.querySelector('#fs-hook');
  if (bobber) { bobber.style.opacity = '1'; }
  void (bobber && bobber.offsetHeight);
  if (line) { line.style.height = `${restY + 6}px`; line.style.transform = `translateX(${dx}px)`; }   // dead vertical so the hook lands on the line's tip
  if (bobber) { bobber.style.top = `${restY}px`; bobber.style.transform = `translateX(${dx}px)`; }
  // The baited hook hangs on the leader just below the float.
  if (hook) { hook.style.opacity = '1'; hook.style.transform = `translateX(${dx}px)`; hook.style.top = `${restY + 14}px`; }

  schedule(() => {
    fsfx('fishing-splash', 'hololock-tick');
    if (ripple) { ripple.style.top = `${restY + 4}px`; ripple.style.transform = `translateX(${dx}px) scale(.4)`; ripple.classList.remove('fs-go'); void ripple.offsetHeight; ripple.classList.add('fs-go'); }
    if (bobber) bobber.classList.add('fs-bob');
    setStatus('<span style="color:#7fae99">The float settles on the black water&hellip;</span>');
  }, 520);

  schedule(() => {
    const sinkY = Math.round(h * Math.min(0.82, 0.42 + _state.castPower * 0.42));
    if (bobber) { bobber.classList.remove('fs-bob'); bobber.style.top = `${sinkY}px`; }
    if (hook) hook.style.top = `${sinkY + 14}px`;   // the take drags the hook under with the float
    if (line) line.style.height = `${sinkY}px`;
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

// ── Cast → fight handoff ────────────────────────────────────────────────────────
// The pay-out animation and the server's fight-arm race each other. Whichever
// lands second kicks off the fight.
function tryStartFight() {
  if (!_state || _state.over) return;
  _state.castAnimDone = true;
  if (_state.fightReady) startFight();
  else setStatus('<span style="color:#7fae99">Setting the hook&hellip;</span>');
}

// Called from dispatch.js when the server's `fishing_fight` message arrives with
// the chosen catch's real difficulty. Builds the fight board and, if the cast
// animation has already finished, starts the fight.
export function armFishFight({ skill = 4, difficulty = 5 } = {}) {
  if (!_state || _state.over) return;
  _state.fightParams = generateFight(skill, difficulty, _state.castPower || 0);
  _state.fightReady = true;
  const fishEl = _overlay?.querySelector('#fs-fish');
  if (fishEl) fishEl.style.setProperty('--fs-menace', String(_state.fightParams.menace));
  if (_state.castAnimDone) startFight();
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
  if (!_state || _state.over || _state.phase === 'fight') return;
  Object.assign(_state, _state.fightParams);
  _state.phase = 'fight';
  const gaff = _overlay.querySelector('#fs-gaff');
  const fish = _overlay.querySelector('#fs-fish');
  const line = _overlay.querySelector('#fs-line');
  if (gaff) gaff.style.opacity = '1';
  if (fish) { fish.style.opacity = '1'; fish.style.setProperty('--fs-menace', String(_state.menace)); }
  if (line) line.style.opacity = '1';
  // The hook is now set in the catch: eat the bait, drop the drop-lag, ride the fish.
  const hook = _overlay.querySelector('#fs-hook');
  if (hook) { hook.classList.add('fs-set'); hook.style.transform = 'none'; hook.style.opacity = '1'; }
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  if (reelBtn) { reelBtn.textContent = 'Reel In ␣'; reelBtn.removeAttribute('disabled'); }
  render();
  renderHud('ON THE LINE');
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
// One primary input drives every stage: during aim it locks the angle and starts
// charging; releasing fires the cast; during the fight it reels the gaff up.
function primaryDown() {
  if (!_state) return;
  if (_state.phase === 'aim') { beginCharge(); return; }
  if (_state.phase === 'fight') { setHold(true); return; }
}
function primaryUp() {
  if (!_state) return;
  if (_state.phase === 'charging') { fireCast(); return; }
  if (_state.phase === 'fight') { setHold(false); return; }
}
function setHold(on) {
  if (on && (!_state || _state.phase !== 'fight')) return;
  if (on && !_hold) fsfx('fishing-reel', 'hololock-tick');   // ratchet bites as you start winding
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
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, onCast: null, ...opts };
  const bubbles = [
    '<span class="fs-bubble" style="left:18%;animation-delay:0s"></span>',
    '<span class="fs-bubble" style="left:34%;animation-delay:2.1s"></span>',
    '<span class="fs-bubble" style="left:58%;animation-delay:1.5s"></span>',
    '<span class="fs-bubble" style="left:44%;animation-delay:3.4s"></span>',
    '<span class="fs-bubble" style="left:72%;animation-delay:2.8s"></span>',
    '<span class="fs-bubble" style="left:84%;animation-delay:4.1s"></span>',
  ].join('');
  // Marine snow — slow motes drifting down the shaft, deterministic (no RNG so
  // the layout is stable across opens); durations/positions hand-scattered.
  const snowSpecs = [[12, 9, 0], [28, 12, 3.5], [46, 8, 1.8], [63, 13, 5.2], [79, 10, 2.6], [90, 11, 4.4], [21, 14, 6.1], [55, 9, 7.3]];
  const snow = snowSpecs.map(([l, d, delay]) =>
    `<span class="fs-snow" style="left:${l}%;animation-duration:${d}s;animation-delay:${delay}s"></span>`).join('');
  // Fathom depth scale — surface (0) at the top, the deep at the bottom. Pure
  // numbers; the shaft's own zone captions name the strata where they sit.
  const scale =
    `<div class="fs-scale">
      <div class="fs-scale-mark">0 ft</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">20</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">40</div>
      <div class="fs-scale-zone"></div>
      <div class="fs-scale-mark">60 ft</div>
    </div>`;
  const html =
    `<div class="fs-panel mg-chassis">
      ${deviceHeader('&#127907;', 'REEL', 'ON THE LINE &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="fs-hud">
        <span class="fs-phases">
          <span class="fs-ph" data-ph="aim">AIM</span><span class="fs-ph-sep">&#8250;</span>
          <span class="fs-ph" data-ph="charge">CHARGE</span><span class="fs-ph-sep">&#8250;</span>
          <span class="fs-ph" data-ph="reel">REEL</span>
        </span>
        <span class="fs-read" id="fs-read">READY</span>
        <span class="fs-creel-wrap">CREEL <span class="fs-creel-bar"><span class="fs-creel-fill" id="fs-creel-fill"></span></span></span>
      </div>
      <div class="fs-bezel mg-bezel">${bezelScrews()}<div class="fs-screen mg-screen" style="--mg-sweep-h:440px">
        <div class="fs-rig">
          ${scale}
          <div class="fs-column" id="fs-column">
            <div class="fs-surface"></div>
            <div class="fs-ruler" id="fs-ruler"></div>
            <div class="fs-lane" id="fs-lane"></div>
            ${snow}
            ${bubbles}
            <span class="fs-zonecap fs-zonecap-1">SHALLOWS</span>
            <span class="fs-zonecap fs-zonecap-2">THE MURK</span>
            <span class="fs-zonecap fs-zonecap-3">THE DEEP</span>
            <div class="fs-castcap fs-castcap-top">DEEP</div>
            <div class="fs-castcap fs-castcap-bot">SHALLOW</div>
            <div class="fs-aim" id="fs-aim">${AIM_SVG}</div>
            <div class="fs-castmeter" id="fs-castmeter"><div class="fs-castfill" id="fs-castfill"></div></div>
            <div class="fs-line" id="fs-line"></div>
            <div class="fs-hook" id="fs-hook">${HOOK_SVG}</div>
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
        <button class="fs-btn fs-btn-reel">Aim</button>
        <button class="fs-btn fs-btn-abort">Cut Line</button>
      </div>
    </div>`;
  const mounted = mountOverlay({
    id: 'fishing-overlay',
    html,
    closeOnBackdrop: false,   // don't let a stray click abandon an active cast/fight
    onClose: () => { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } clearTimers(); clearListeners(); _hold = false; _state = null; },
  });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  _overlay.querySelector('.fs-btn-abort').addEventListener('click', close);

  // Primary input: the button, the water column, and Space. Press locks the aim
  // and charges; release fires the cast; in the fight, hold reels the gaff up.
  const reelBtn = _overlay.querySelector('.fs-btn-reel');
  const column = _overlay.querySelector('#fs-column');
  const down = (e) => { e.preventDefault(); primaryDown(); };
  const up = () => primaryUp();
  addListener(reelBtn, 'pointerdown', down);
  addListener(column, 'pointerdown', down);
  addListener(window, 'pointerup', up);
  addListener(window, 'pointercancel', up);
  addListener(window, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); primaryDown(); } });
  addListener(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); primaryUp(); } });

  window.AudioEngine?.init?.();

  _state = generateCast(_opts.skill, _opts.difficulty);
  render();
  startCast();
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
