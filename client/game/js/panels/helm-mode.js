// Echelon Helm mode — the in-game console. Takes over the AREA PANE like the flight sim (the
// sidebar, top bar and log stay put; the ⛶ chip toggles true OS fullscreen), with the chase view
// filling the pane under a glass brass dash: the ship's wheel
// (course), an engine telegraph you drag to engage (the throttle), read-only instruments, and live
// WX/time chips synced from the world exactly like the flight sim. Time and weather are NOT
// settable here — they're the real sim's, streamed in. Dependency-free: the game passes callbacks
// (onSail/onExit) so this module never imports net/dispatch, and the standalone rig can drive it.
//
// openHelm({ mount, gx, gy, heading, sky, transitMs, accent, onSail(dir), onExit() }) → controller
// isHelmActive() — dispatch guards room look/move renders on this (mirrors isFlightSimActive()).
// helmSetSky(sky) / helmEndTransit(gx,gy) — the server streams the live sky + confirms arrivals.

import { openHelmChase } from './helm-view.js';
import { createHelmWheel } from './helm-wheel.js';

// The passage length is now the server's authoritative `ms` (distance × the throttle bell), streamed
// on helm_underway; the telegraph derives a local placeholder timer from the same bell math and the
// server's helm_arrived releases the lock precisely.
let _helm = null;
export function isHelmActive() { return !!_helm; }
// The server streams the live sim sky (real weather field) while the helm is open, and confirms an
// arrival at the end of a passage — both routed here by dispatch.
export function helmSetSky(sky) { _helm?.ctrl?.setSky(sky); }
export function helmSetWorld(rows, cx, cy) { _helm?.ctrl?.setWorld(rows, cx, cy); }
export function helmSetContacts(list) { _helm?.ctrl?.setContacts(list); }
export function helmEndTransit(gx, gy) { _helm?.ctrl?.endTransit(gx, gy); }
// The server confirms a passage's true vector (direction + tile count) so the chase view glides her
// the whole distance — fired for the telegraph AND a typed `sail`, so either path animates the helm.
export function helmBeginTransit(dir, tiles, ms, cruise, path) { _helm?.ctrl?.beginTransit(dir, ms, ms, tiles, cruise, path); }

export function ensureHelmStyles() {
  // Reuse the tag if present, but ALWAYS rewrite its content — never early-return. A stale style
  // block (e.g. left by an older build, or a tag that outlived a close) would otherwise pin the old
  // layout while this module's JS runs fresh, producing a half-old/half-new "mixed" helm.
  const s = document.getElementById('helm-mode-styles') || document.createElement('style');
  s.id = 'helm-mode-styles';
  s.textContent = `
    /* Takes over the area pane like the flight sim — the sidebar, top bar and log stay put. Fills
       the pane's height the way the glass cockpit does; the ⛶ chip toggles true OS fullscreen. */
    /* The helm OWNS the pane — it must never scroll (a scroll steals the orbit drag and can float the
       console off the ship). Pin the pane + root: no overflow, no touch-scroll/overscroll chaining, so
       everything always fits and a drag on the sea always orbits. */
    #area-content:has(.helm-root){ height:100%; overflow:hidden; overscroll-behavior:contain; touch-action:none; }
    .helm-root{ position:relative; width:100%; height:100%; min-height:420px; overflow:hidden; overscroll-behavior:contain; touch-action:none;
      --hs:1;   /* console scale — a fixed constant (desktop-only); the transparent dash keeps the ship clear at any pane size */
      /* Theme-following palette. The console BODY (frosted glass wings, brushed-metal binnacle/band,
         telegraph housing, chart window, chips) derives from the player's global theme — so it reads
         LIGHT on a light theme and DARK on a dark one, with the theme --accent as its accent. The
         recessed gauge SCREENS stay dark glowing HUD glass (a designed instrument-cluster look that
         reads over any dashboard); their ink is --screen-* which stays light on both themes, and their
         accents are tinted from --accent so the whole console still moves with the theme. */
      --accent-hi:color-mix(in srgb,var(--accent) 40%,#fff); --accent-lo:color-mix(in srgb,var(--accent) 62%,#000);
      --chart:var(--accent); --hink:var(--text); --hdim:var(--text-dim); --stbd:var(--green);
      --glass:color-mix(in srgb,var(--bg2) 60%,transparent); --sheen:color-mix(in srgb,var(--accent) 16%,transparent);
      --metal-hi:color-mix(in srgb,var(--text) 22%,var(--bg3)); --metal:color-mix(in srgb,var(--text) 10%,var(--bg2)); --metal-lo:color-mix(in srgb,#000 16%,var(--bg));
      --steel-hi:color-mix(in srgb,var(--text) 30%,var(--bg3)); --steel:color-mix(in srgb,var(--text) 15%,var(--bg2)); --steel-lo:color-mix(in srgb,#000 20%,var(--bg2));
      --screen-dim:color-mix(in srgb,var(--accent) 40%,#8ba0ae);
      --hmono:'DejaVu Sans Mono','Consolas','Courier New',monospace; --hsans:'Helvetica Neue',Arial,system-ui,sans-serif;
      --hcarbon:repeating-linear-gradient(45deg,color-mix(in srgb,var(--bg) 82%,#000) 0 3px,color-mix(in srgb,var(--bg) 92%,#000) 3px 6px),repeating-linear-gradient(-45deg,color-mix(in srgb,var(--text) 12%,transparent) 0 3px,transparent 3px 6px);
      font-family:var(--hsans); color:var(--hink); border-radius:8px; background:var(--bg); }
    .helm-root:fullscreen{ height:100vh; border-radius:0; }
    .helm-chase{ position:absolute; inset:0; z-index:0; touch-action:none; }   /* orbit drag lives here — never let a touch become a scroll/pan */
    .helm-chase canvas{ cursor:grab; } .helm-chase canvas:active{ cursor:grabbing; }
    .helm-placard{ position:absolute; top:12px; left:14px; z-index:6; display:flex; align-items:center; gap:9px; pointer-events:none; }
    .helm-placard .m{ width:20px; height:20px; border-radius:50%; border:1.5px solid var(--accent);
      background:radial-gradient(circle at 50% 35%,var(--accent-hi),var(--accent-lo)); box-shadow:0 0 12px color-mix(in srgb,var(--accent) 55%,transparent); }
    .helm-placard .n{ font-family:var(--hmono); letter-spacing:5px; color:var(--accent); font-size:13px; font-weight:700; }
    .helm-placard .n small{ color:var(--hdim); letter-spacing:2px; }
    .helm-chips{ position:absolute; top:12px; right:14px; z-index:6; display:flex; gap:8px; align-items:center; font-family:var(--hmono); }
    .helm-chip{ background:color-mix(in srgb,var(--bg) 62%,transparent); border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:8px;
      padding:5px 10px; font-size:12px; letter-spacing:1px; backdrop-filter:blur(3px); color:var(--hink); }
    .helm-chip b{ color:var(--accent-hi); }
    .helm-icon{ background:color-mix(in srgb,var(--bg) 62%,transparent); border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:8px;
      color:var(--accent); font-size:15px; width:34px; height:32px; cursor:pointer; backdrop-filter:blur(3px); line-height:1; }
    .helm-icon:hover{ filter:brightness(1.25); } .helm-icon.on{ background:var(--accent); color:var(--accent-ink,#05141f); }
    .helm-icon.exit{ color:#ff8a7a; border-color:color-mix(in srgb,#ff8a7a 40%,transparent); font-weight:700; }
    /* ── The console ──────────────────────────────────────────────────────────────
       A single machined brushed-metal helm station laid across the bottom of the view.
       The ship's wheel rises out of a binnacle at its centre so its lower half tucks
       behind the console lip; the NAV chart + digital instruments + engine telegraph
       are milled into the face. Cool cyan HUD glass on brushed steel + carbon fibre. */
    /* The dash spans the pane's whole bottom, but in the windowed state it's mostly TRANSPARENT — so
       the container chain is pointer-transparent (a drag through the empty gaps falls through to the
       sea and orbits). Only the actual visible controls (the frosted wings, telegraph, wheel canvas,
       nav chart) opt pointer events back in below. Without this, the invisible dash rectangle swallowed
       every drag that began level with it, so you could only orbit by grabbing ABOVE the whole console. */
    .helm-dash{ position:absolute; left:0; right:0; bottom:0; z-index:5; pointer-events:none; }
    .helm-console, .helm-console-face{ pointer-events:none; }
    .helm-left, .helm-right, .helm-tele, .helm-nav-bezel{ pointer-events:auto; }
    /* The console is now a single machined BLACK-GLASS station in every state — an expensive slab of
       obsidian glass milled with an accent hairline along its lip, so the helm reads as one designed
       object floating over the water rather than a scatter of controls. A soft top glow lifts it off
       the sea; the accent seam catches the eye. Fullscreen just deepens it. */
    /* Windowed (non-fullscreen): the console slab is FULLY TRANSPARENT so it never darkens the water
       or hides the Echelon — the ship reads clean through it. The frosted instrument wings + telegraph
       carry their own backdrop-glass, so the readouts stay legible with no slab behind them. Only the
       accent lip seam (::before) marks the console's edge. Fullscreen re-adds the smoked-glass slab. */
    .helm-console{ position:relative; padding:6px 0 calc(6px + env(safe-area-inset-bottom)); border-radius:16px 16px 0 0;
      background:none; box-shadow:none; }
    /* a bright accent seam runs the lip — the money line that says "this cost something" */
    .helm-console::before{ content:''; position:absolute; left:8%; right:8%; top:0; height:1px; pointer-events:none;
      background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--accent) 20%,transparent) 18%,var(--accent-hi) 50%,color-mix(in srgb,var(--accent) 20%,transparent) 82%,transparent);
      box-shadow:0 0 10px color-mix(in srgb,var(--accent) 60%,transparent); opacity:.85; }
    /* Fullscreen re-adds the smoked-glass slab, so it's a solid surface again — recapture pointers on
       it (the windowed click-through is only for the transparent windowed console). */
    body.helm-fullscreen .helm-console{ pointer-events:auto; }
    body.helm-fullscreen .helm-console{ border-radius:0;
      background:
        linear-gradient(180deg,color-mix(in srgb,var(--accent) 12%,transparent) 0,transparent 30%),
        radial-gradient(160% 140% at 50% -20%,color-mix(in srgb,var(--bg2) 88%,transparent) 0,color-mix(in srgb,var(--bg) 92%,transparent) 42%,color-mix(in srgb,var(--bg) 96%,#000) 100%);
      -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px);
      border-top:1px solid color-mix(in srgb,var(--accent) 34%,transparent);
      box-shadow:inset 0 1px 0 color-mix(in srgb,var(--accent) 26%,transparent), inset 0 -1px 0 color-mix(in srgb,#000 40%,transparent), 0 -22px 54px color-mix(in srgb,var(--bg) 70%,transparent); }
    /* [ nav+position + gauges ] | WHEEL | telegraph — the wheel is the centred centrepiece, flanked
       by the instrument cluster (left) and the engine telegraph (right). The 1fr/auto/1fr columns
       keep the wheel dead-centre in the bar. All still in-bar, so the water above stays clear. */
    .helm-console-face{ position:relative; isolation:isolate; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:calc(20px*var(--hs));
      padding:calc(3px*var(--hs)) calc(26px*var(--hs)) calc(4px*var(--hs)); max-width:1280px; margin:0 auto; }
    /* Left instrument cluster — a FROSTED TRANSLUCENT GLASS panel that floats over the sea: it really
       blurs the water behind it (backdrop-filter), with chamfered tech-panel corners, a bright glass
       top edge and a faint accent tint. The instruments read like they're etched into a slab of smoked
       glass. */
    .helm-left{ justify-self:start; display:flex; align-items:center; gap:calc(16px*var(--hs)); min-width:0; position:relative;
      padding:calc(9px*var(--hs)) calc(26px*var(--hs)) calc(9px*var(--hs)) calc(18px*var(--hs));
      background:linear-gradient(180deg,var(--sheen),var(--glass) 46%,color-mix(in srgb,var(--bg) 70%,transparent));
      -webkit-backdrop-filter:blur(7px) saturate(1.2); backdrop-filter:blur(7px) saturate(1.2);
      /* raked cockpit wing: the wheel-facing (right) edge slopes inward at the base, chamfered corners */
      clip-path:polygon(14px 0,100% 0,calc(100% - 24px) 100%,14px 100%,0 calc(100% - 14px),0 14px);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.22), 0 8px 22px rgba(0,0,0,.30); }
    /* accent sheen + a hairline that follows the chamfered glass edge */
    .helm-left::before{ content:''; position:absolute; inset:0; pointer-events:none; clip-path:inherit;
      background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 20%,transparent),transparent 42%),
        linear-gradient(0deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent 30%);
      mix-blend-mode:screen; opacity:.7; }
    /* faint carbon-fibre weave milled into the console face — fullscreen only (part of the panel) */
    body.helm-fullscreen .helm-console-face::before{ content:''; position:absolute; inset:0; pointer-events:none; opacity:.14;
      background:var(--hcarbon); background-size:6px 6px,6px 6px; mix-blend-mode:overlay; }
    /* ── Brushed-metal binnacle — a machined plinth the wheel rises out of. A trapezoid of vertical
       brushed-titanium grain with a beveled accent top lip; sits behind the wheel canvas so the ship's
       wheel emerges from a real turned-metal column, not thin air. Cool shape via the clip-path. */
    .helm-col::before{ content:''; position:absolute; left:50%; bottom:0; transform:translateX(-50%); z-index:-1; pointer-events:none;
      width:calc(196px*var(--hs)); height:calc(84px*var(--hs));
      background:
        repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,rgba(0,0,0,.10) 1px 2px,transparent 2px 3px),
        linear-gradient(180deg,var(--metal-hi) 0,var(--metal) 46%,var(--metal-lo) 100%);
      clip-path:polygon(20% 0,80% 0,100% 100%,0 100%);
      border-top:1px solid color-mix(in srgb,var(--accent) 45%,transparent);
      box-shadow:inset 0 2px 0 rgba(255,255,255,.28), inset 0 -6px 14px rgba(0,0,0,.5), 0 -3px 16px rgba(0,0,0,.4); }
    /* the accent lip glows along the top bevel of the binnacle */
    .helm-col::after{ content:''; position:absolute; left:50%; bottom:calc(83px*var(--hs)); transform:translateX(-50%); z-index:-1; pointer-events:none;
      width:calc(118px*var(--hs)); height:2px; border-radius:2px;
      background:linear-gradient(90deg,transparent,var(--accent-hi),transparent); box-shadow:0 0 10px color-mix(in srgb,var(--accent) 70%,transparent); opacity:.8; }
    /* A brushed-titanium band milled across the CENTRE of the console face (behind the wheel/binnacle),
       chamfered at both ends — the solid "brushed metal area" the glass wings flank. Kept central so
       the frosted panels either side stay over open, translucent console with the sea shimmering behind. */
    .helm-console-face::after{ content:''; position:absolute; left:34%; right:34%; bottom:calc(3px*var(--hs)); height:calc(52px*var(--hs)); z-index:-1; pointer-events:none;
      background:
        repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,rgba(0,0,0,.06) 1px 2px,transparent 2px 4px),
        linear-gradient(180deg,var(--metal) 0,color-mix(in srgb,var(--metal) 70%,#000) 55%,var(--metal-lo) 100%);
      clip-path:polygon(26px 0,calc(100% - 26px) 0,100% 100%,0 100%);
      border-top:1px solid color-mix(in srgb,var(--accent) 22%,transparent);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.16), 0 -2px 12px rgba(0,0,0,.4); }

    /* NAV chart — top-down basin scope, sunk into a raised machined bezel so it reads as a real
       recessed radar screen: a black chamfered frame with corner bolts, the screen dropped below the
       lip with a deep inner shadow + accent rim glow. The bezel is the expensive frame; the scope is
       the glass. Clicking it opens the full chart popup (the touch target for plotting a course). */
    .helm-nav{ display:flex; align-items:center; gap:14px; }
    .helm-nav-bezel{ position:relative; flex:0 0 auto; padding:calc(7px*var(--hs)); border-radius:14px; cursor:pointer;
      background:
        radial-gradient(circle at calc(7px*var(--hs)) calc(7px*var(--hs)),color-mix(in srgb,var(--text) 24%,var(--bg3)) 0 1.4px,transparent 1.7px),
        radial-gradient(circle at calc(100% - 7px*var(--hs)) calc(7px*var(--hs)),color-mix(in srgb,var(--text) 24%,var(--bg3)) 0 1.4px,transparent 1.7px),
        radial-gradient(circle at calc(7px*var(--hs)) calc(100% - 7px*var(--hs)),color-mix(in srgb,var(--text) 24%,var(--bg3)) 0 1.4px,transparent 1.7px),
        radial-gradient(circle at calc(100% - 7px*var(--hs)) calc(100% - 7px*var(--hs)),color-mix(in srgb,var(--text) 24%,var(--bg3)) 0 1.4px,transparent 1.7px),
        linear-gradient(180deg,var(--metal),var(--metal-lo) 70%,color-mix(in srgb,var(--bg) 92%,#000));
      border:1px solid color-mix(in srgb,#000 45%,var(--border));
      box-shadow:0 1px 0 color-mix(in srgb,var(--accent) 22%,transparent), inset 0 1px 0 rgba(255,255,255,.06), 0 3px 8px rgba(0,0,0,.5); }
    .helm-nav-bezel:hover{ box-shadow:0 1px 0 color-mix(in srgb,var(--accent) 40%,transparent), inset 0 1px 0 rgba(255,255,255,.06), 0 0 12px color-mix(in srgb,var(--accent) 30%,transparent); }
    .helm-nav-scope{ position:relative; width:calc(126px*var(--hs)); height:calc(84px*var(--hs)); border-radius:8px; overflow:hidden;
      background:radial-gradient(120% 130% at 50% 26%,color-mix(in srgb,var(--accent) 14%,#02121a) 0,#020c11 55%,#010609 100%);
      box-shadow:
        0 0 0 1px color-mix(in srgb,var(--accent) 30%,#000),
        inset 0 0 26px rgba(0,0,0,.94), inset 0 0 11px color-mix(in srgb,var(--accent) 22%,transparent),
        inset 0 3px 7px rgba(0,0,0,.9); }
    .helm-nav-scope canvas{ display:block; width:100%; height:100%; }
    /* curved-glass glare + faint horizontal scanlines over the screen for a CRT feel */
    .helm-nav-scope::before{ content:''; position:absolute; inset:0; pointer-events:none; z-index:3; border-radius:8px;
      background:radial-gradient(120% 80% at 50% -10%,rgba(255,255,255,.08),transparent 60%); }
    .helm-nav-scope::after{ content:''; position:absolute; inset:0; pointer-events:none;
      background:repeating-linear-gradient(0deg,rgba(0,0,0,.24) 0 1px,transparent 1px 3px); mix-blend-mode:multiply; }
    .helm-nav-tag{ position:absolute; left:7px; top:6px; font-family:var(--hmono); font-size:8px; letter-spacing:2px; z-index:4;
      color:color-mix(in srgb,var(--chart) 82%,#fff); text-shadow:0 0 6px color-mix(in srgb,var(--chart) 70%,transparent); }
    .helm-nav-hint{ position:absolute; right:6px; bottom:5px; font-family:var(--hmono); font-size:7px; letter-spacing:1.5px; z-index:4;
      color:var(--screen-dim); opacity:.85; }

    /* Digital instrument readouts — recessed HUD glass, cyan phosphor. Sized off --hs so the readouts
       (which drive the bar's HEIGHT) scale WITH the rest of the station as one machined object. */
    .helm-gauges{ display:grid; grid-template-columns:repeat(2,1fr); gap:calc(9px*var(--hs)); }
    /* Right wing — the ETA/status gauge stack riding beside the engine telegraph. Kept a single
       column so the two readouts sit tall against the telegraph, balancing the nav+heading cluster
       on the left. */
    .helm-right{ justify-self:end; grid-column:3; display:flex; align-items:stretch; gap:calc(14px*var(--hs)); min-width:0; }
    .helm-gauges.rt{ grid-template-columns:1fr; align-content:center; min-width:calc(112px*var(--hs)); }
    .helm-readout{ position:relative; padding:calc(6px*var(--hs)) calc(11px*var(--hs)) calc(7px*var(--hs)); border-radius:8px; overflow:hidden;
      /* recessed dark HUD gauge — stays dark on any theme (like a car's instrument cluster), tinted by accent */
      background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 12%,#04141b) 0,#020a0e 100%);
      border:1px solid color-mix(in srgb,var(--accent) 28%,#000);
      box-shadow:inset 0 0 14px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05); }
    .helm-readout.wide{ flex:1; min-width:0; }
    .helm-readout .rk{ display:block; font-family:var(--hmono); font-size:calc(8px*var(--hs)); letter-spacing:2.5px; text-transform:uppercase;
      color:var(--screen-dim); }
    .helm-readout .rv{ display:block; margin-top:2px; font-family:var(--hmono); font-weight:700; font-size:calc(17px*var(--hs)); letter-spacing:1px;
      font-variant-numeric:tabular-nums; color:color-mix(in srgb,var(--chart) 85%,#fff);
      text-shadow:0 0 7px color-mix(in srgb,var(--chart) 55%,transparent); }
    .helm-readout .rv.big{ font-size:calc(22px*var(--hs)); letter-spacing:2px; }
    .helm-readout .rv.sm{ font-size:calc(13px*var(--hs)); letter-spacing:1.5px; }
    .helm-readout .rv i{ font-style:normal; font-size:9px; margin-left:3px; opacity:.6; letter-spacing:.5px; }
    .helm-readout.eta .rv{ color:color-mix(in srgb,var(--accent-hi) 88%,#fff); text-shadow:0 0 7px color-mix(in srgb,var(--accent) 55%,transparent); }
    .helm-readout.eta.idle .rv{ color:var(--screen-dim); text-shadow:none; }
    .helm-readout.st .rv{ color:var(--screen-dim); text-shadow:none; }
    .helm-readout.st.busy .rv{ color:var(--stbd); text-shadow:0 0 7px color-mix(in srgb,var(--stbd) 55%,transparent); }

    /* Ship's wheel — a normal column INSIDE the console bar (no longer a floating binnacle above it),
       so it can never rise into the water/ship view. Sized to sit within the bar's height. */
    /* The wheel is lifted OUT of the flow (absolute, centred) so it no longer stretches the console
       bar — that lets the bar be thin while the wheel rises out of it like a binnacle, its lower half
       docked in the bar and its top arc hanging over the lip into the water. bottom:0 seats it on the
       console floor; being taller than the thin bar, the overhang happens for free. */
    .helm-col{ position:absolute; left:50%; bottom:0; transform:translateX(-50%); z-index:7;
      display:flex; flex-direction:column; align-items:center; gap:3px; pointer-events:none; }
    .helm-col canvas{ pointer-events:auto; }
    .helm-col .cap{ display:none; }   /* the COURSE cap is redundant — the wheel is self-evident */
    .helm-wheel{ width:calc(150px*var(--hs)); height:calc(150px*var(--hs)); filter:drop-shadow(0 6px 14px rgba(0,0,0,.7)); }
    /* Heading strip — a compass tape riding just above the wheel; display-only (never grabs the pointer). */
    .helm-strip{ width:calc(216px*var(--hs)); height:calc(30px*var(--hs)); pointer-events:none !important;
      filter:drop-shadow(0 2px 6px rgba(0,0,0,.55)); }
    .helm-col .cap{ font-family:var(--hmono); font-size:8px; letter-spacing:4px; color:color-mix(in srgb,var(--accent) 70%,var(--hdim)); text-transform:uppercase;
      background:rgba(4,7,11,.6); padding:1px 8px; border-radius:4px; }

    /* Engine telegraph — a milled steel lever in a carbon slot, right of the console */
    /* Engine telegraph — housed in its own frosted-glass panel (matching the instrument cluster) so
       the lever sits in a slab of smoked glass over the sea, chamfered to match. */
    .helm-tele{ display:flex; flex-direction:column; align-items:center; gap:7px; user-select:none; position:relative;
      padding:calc(9px*var(--hs)) calc(16px*var(--hs)) calc(9px*var(--hs)) calc(24px*var(--hs));
      background:linear-gradient(180deg,var(--sheen),var(--glass) 46%,color-mix(in srgb,var(--bg) 70%,transparent));
      -webkit-backdrop-filter:blur(7px) saturate(1.2); backdrop-filter:blur(7px) saturate(1.2);
      /* mirror of the left wing: the wheel-facing (left) edge slopes inward at the base */
      clip-path:polygon(24px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.22), 0 8px 22px rgba(0,0,0,.30); }
    .helm-tele::before{ content:''; position:absolute; inset:0; pointer-events:none; clip-path:inherit; z-index:0;
      background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 20%,transparent),transparent 42%); mix-blend-mode:screen; opacity:.7; }
    .helm-tele > *{ position:relative; z-index:1; }
    /* A big, commanding engine telegraph — a taller, wider machined slot so the lever reads as the
       primary "get underway" control, not an afterthought. Black carbon body, accent-lit when engaged. */
    .helm-tele-track{ position:relative; width:calc(74px*var(--hs)); height:calc(132px*var(--hs)); border-radius:13px;
      background:var(--hcarbon),linear-gradient(180deg,color-mix(in srgb,var(--bg) 88%,#000),color-mix(in srgb,var(--bg) 95%,#000)); background-size:6px 6px,6px 6px,auto;
      border:1px solid color-mix(in srgb,var(--accent) 22%,#000);
      box-shadow:inset 0 2px 12px rgba(0,0,0,.9),0 1px 0 color-mix(in srgb,var(--accent) 16%,transparent); overflow:hidden; }
    .helm-tele-track::before{ content:''; position:absolute; left:50%; top:18px; bottom:18px; width:8px; transform:translateX(-50%);
      border-radius:5px; background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 92%,#000),color-mix(in srgb,var(--bg3) 60%,#000)); box-shadow:inset 0 0 6px rgba(0,0,0,.95); }
    .helm-tele-mark{ position:absolute; left:0; right:0; text-align:center; font-family:var(--hmono); font-size:9px; letter-spacing:2.5px; color:var(--screen-dim); pointer-events:none; z-index:2; }
    .helm-tele-mark.ahead{ top:9px; color:var(--stbd); } .helm-tele-mark.stop{ bottom:9px; }
    /* brushed-steel knob: fine vertical grain + machined grip ridges */
    .helm-tele-knob{ position:absolute; left:8px; right:8px; height:44px; top:78px; border-radius:9px; cursor:grab; touch-action:none; z-index:3;
      background:repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0 1px,rgba(0,0,0,.10) 1px 2px,transparent 2px 3px),linear-gradient(180deg,var(--steel-hi),var(--steel) 52%,var(--steel-lo));
      border:1px solid #20262c; box-shadow:0 4px 10px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.7),inset 0 -2px 5px rgba(0,0,0,.4); }
    .helm-tele-knob::after{ content:''; position:absolute; left:8px; right:8px; top:50%; height:9px; transform:translateY(-50%);
      background:repeating-linear-gradient(90deg,rgba(0,0,0,.42) 0 2px,rgba(255,255,255,.12) 2px 3px,transparent 3px 4px); border-radius:3px; }
    .helm-tele-knob:active{ cursor:grabbing; }
    .helm-tele.engaged .helm-tele-knob{ cursor:not-allowed; box-shadow:0 0 14px var(--stbd),0 3px 8px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.7); }
    .helm-tele.engaged .helm-tele-track{ border-color:var(--stbd); box-shadow:inset 0 2px 10px rgba(0,0,0,.85),0 0 12px color-mix(in srgb,var(--stbd) 40%,transparent); }
    .helm-tele-label{ font-family:var(--hmono); font-size:8px; letter-spacing:2.5px; color:var(--hdim); text-transform:uppercase; }
    .helm-tele.warn .helm-tele-label{ color:#ff8a7a; }
    .helm-tele.course .helm-tele-label{ color:var(--accent-hi); }

    /* ── Chart popup — a tablet-styled navigation window over the whole helm ── */
    .helm-map{ position:absolute; inset:0; z-index:20; display:none; flex-direction:column;
      background:radial-gradient(150% 100% at 50% 0,color-mix(in srgb,var(--bg) 82%,transparent),color-mix(in srgb,var(--bg) 95%,#000)); backdrop-filter:blur(7px); }
    .helm-map.open{ display:flex; }
    .helm-map-win{ margin:auto; width:min(600px,94%); max-height:94%; display:flex; flex-direction:column; overflow:hidden;
      background:linear-gradient(180deg,var(--bg2),var(--bg)); border:1px solid color-mix(in srgb,var(--accent) 32%,var(--border)); border-radius:18px;
      box-shadow:0 26px 70px rgba(0,0,0,.55), inset 0 1px 0 color-mix(in srgb,var(--accent) 22%,transparent), 0 0 0 1px color-mix(in srgb,#000 40%,transparent); }
    .helm-map-head{ display:flex; align-items:flex-start; justify-content:space-between; padding:14px 18px;
      border-bottom:1px solid color-mix(in srgb,var(--accent) 16%,transparent); background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 8%,transparent),transparent); }
    .helm-map-head .t{ font-family:var(--hmono); letter-spacing:3px; font-size:13px; color:var(--accent-hi); }
    .helm-map-head .t small{ display:block; margin-top:3px; font-size:9px; letter-spacing:1.5px; color:var(--hdim); }
    .helm-map-close{ background:color-mix(in srgb,var(--text) 6%,transparent); border:1px solid color-mix(in srgb,var(--text) 14%,transparent); color:var(--hink);
      width:30px; height:28px; border-radius:8px; cursor:pointer; font-size:13px; line-height:1; }
    .helm-map-close:hover{ filter:brightness(1.3); }
    .helm-map-body{ position:relative; padding:16px; }
    .helm-map-canvas{ display:block; width:100%; border-radius:11px; background:#01080c; cursor:crosshair;
      box-shadow:inset 0 0 34px rgba(0,0,0,.92), 0 0 0 1px color-mix(in srgb,var(--chart) 20%,#000); }
    .helm-map-foot{ display:flex; align-items:center; gap:12px; padding:13px 18px; border-top:1px solid color-mix(in srgb,var(--accent) 16%,transparent); }
    .helm-map-info{ flex:1; font-family:var(--hmono); font-size:11px; letter-spacing:.5px; color:var(--hdim); }
    .helm-map-info b{ color:var(--accent-hi); }
    .helm-map-btn{ font-family:var(--hmono); letter-spacing:2px; font-size:11px; padding:10px 18px; border-radius:10px; cursor:pointer; white-space:nowrap;
      background:color-mix(in srgb,var(--stbd) 16%,var(--bg2)); color:var(--stbd); border:1px solid color-mix(in srgb,var(--stbd) 45%,transparent); }
    .helm-map-btn:hover{ filter:brightness(1.25); }
    .helm-map-btn[disabled]{ opacity:.35; cursor:not-allowed; filter:none; }
    .helm-map-btn.ghost{ background:color-mix(in srgb,var(--text) 6%,transparent); color:var(--hdim); border-color:color-mix(in srgb,var(--text) 14%,transparent); }

    @media (max-width:760px){
      /* Wheel stays the centred binnacle (absolute) hanging over the bar; left cluster + telegraph
         flank it below. Extra side padding keeps them clear of the overhanging wheel. */
      .helm-console-face{ grid-template-columns:1fr auto 1fr; gap:10px; padding:6px 16px 8px; }
      .helm-left{ flex-wrap:wrap; }
      .helm-gauges{ grid-template-columns:repeat(2,1fr); }
      .helm-wheel{ width:calc(128px*var(--hs)); height:calc(128px*var(--hs)); }
      .helm-nav-scope{ width:100px; height:74px; } }`;
  document.head.appendChild(s);
}

const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const HDG_TO_DIR = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
// Tile delta → rhumb letter (for the first leg of a charted course), used to seed the local glide.
const DELTA_LETTER = { '0,-1': 'N', '1,-1': 'NE', '1,0': 'E', '1,1': 'SE', '0,1': 'S', '-1,1': 'SW', '-1,0': 'W', '-1,-1': 'NW' };
const dirLetter = (dx, dy) => DELTA_LETTER[Math.sign(dx) + ',' + Math.sign(dy)] || 'N';
const fmtETA = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function openHelm(opts = {}) {
  const mount = opts.mount || document.getElementById('area-content');
  if (!mount) return null;
  closeHelm();
  ensureHelmStyles();
  // Accent — follows the player's global theme (the wheel LEDs, needle, radar rings/sweep/blip and
  // charted course all take this), so the helm reads in the same colour family as the rest of the UI.
  // The theme vars live on <html>; read the effective --accent/--green (both #rrggbb in themes.css).
  const _hex = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fb; };
  const accent = opts.accent || _hex('--accent', '#5ccfe0');
  const accentGreen = _hex('--green', '#35d07a');
  // rgba/lightened helpers for the canvas instruments (radar scope, heading strip, chart) so their
  // hairlines/glows tint to the theme accent instead of the old pinned cyan.
  const _rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return [92, 207, 224]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const [AR, AG, AB] = _rgb(accent), [GR, GG, GB] = _rgb(accentGreen);
  const acc = (a) => `rgba(${AR},${AG},${AB},${a})`;
  const grn = (a) => `rgba(${GR},${GG},${GB},${a})`;
  const accLite = `rgb(${Math.min(255, AR + 90)},${Math.min(255, AG + 90)},${Math.min(255, AB + 90)})`;
  const onSail = opts.onSail || (() => {});
  const onSailTo = opts.onSailTo || (() => {});   // fires the real `sailto <x> <y> <bell%>` when a charted course is engaged
  const onStop = opts.onStop || (() => {});       // fires the real `stop` — cut the throttle to halt her mid-passage
  const onExit = opts.onExit || (() => {});

  mount.innerHTML = `
    <div class="helm-root">
      <div class="helm-chase"></div>
      <div class="helm-placard"><span class="m"></span><span class="n">ECHELON&nbsp; <small>HELM</small></span></div>
      <div class="helm-chips">
        <span class="helm-chip"><b data-wx>CLEAR</b></span>
        <span class="helm-chip"><b data-time>--:--</b></span>
        <button class="helm-icon" data-chart title="chart a course">🗺</button>
        <button class="helm-icon" data-fs title="fullscreen">⛶</button>
        <button class="helm-icon exit" data-exit title="leave the helm">✕</button>
      </div>
      <div class="helm-dash">
        <div class="helm-console">
          <div class="helm-console-face">
            <!-- Left instrument cluster: NAV scope + position + the digital gauge stack. -->
            <div class="helm-left">
              <!-- NAV chart: live top-down basin chart with the Echelon's blip. Tap to open the
                   full chart popup and plot a course. -->
              <div class="helm-nav">
                <div class="helm-nav-bezel" data-chart title="open the chart — plot a course">
                  <div class="helm-nav-scope"><canvas data-nav></canvas><span class="helm-nav-tag">NAV · BASIN</span><span class="helm-nav-hint">TAP TO CHART</span></div>
                </div>
                <div class="helm-readout wide"><span class="rk">Position</span><span class="rv" data-pos>— · —</span></div>
              </div>
              <!-- Digital instrument stack — heading + speed live on the LEFT wing, beside the nav
                   scope; ETA + status are on the RIGHT wing (by the telegraph) so the readouts fill
                   both ends of the console and flank the wheel instead of piling up on one side. -->
              <div class="helm-gauges">
                <div class="helm-readout hdg"><span class="rk">Heading</span><span class="rv big" data-hdg>N</span></div>
                <div class="helm-readout"><span class="rk">Speed</span><span class="rv"><span data-kn>0.0</span><i>kn</i></span></div>
              </div>
            </div>
            <!-- Ship's wheel — the centred centrepiece, docked INSIDE the console so it never rises
                 into the water/ship view above the bar. -->
            <div class="helm-col">
              <!-- Heading strip: the eight rhumbs on a sliding tape. The notch the wheel is seated in
                   lights up, and the centre lubber goes green when she's actually ready to make way. -->
              <canvas class="helm-strip" data-strip></canvas>
              <canvas class="helm-wheel"></canvas>
              <div class="cap">Course</div>
            </div>
            <!-- Right wing: ETA + status readouts sit beside the engine telegraph, so the right half
                 of the console carries real instruments instead of dead space. -->
            <div class="helm-right">
              <div class="helm-gauges rt">
                <div class="helm-readout eta idle"><span class="rk">ETA</span><span class="rv" data-eta>—</span></div>
                <div class="helm-readout st"><span class="rk">Status</span><span class="rv sm" data-status>MOORED</span></div>
              </div>
              <!-- Engine telegraph -->
              <div class="helm-tele" data-tele>
                <div class="helm-tele-track">
                  <span class="helm-tele-mark ahead">AHEAD</span>
                  <span class="helm-tele-mark stop">STOP</span>
                  <div class="helm-tele-knob" data-knob></div>
                </div>
                <div class="helm-tele-label" data-telelabel>Engine Telegraph</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Chart popup — a tablet-styled basin map. Tap a water tile to plot a course around the
           shoreline; GET UNDERWAY (or the engine telegraph) engages it. -->
      <div class="helm-map" data-map>
        <div class="helm-map-win">
          <div class="helm-map-head">
            <span class="t">NAVIGATION CHART<small>COLDWATER BASIN · tap open water to plot a course</small></span>
            <button class="helm-map-close" data-mapclose title="close">✕</button>
          </div>
          <div class="helm-map-body"><canvas class="helm-map-canvas" data-mapc></canvas></div>
          <div class="helm-map-foot">
            <span class="helm-map-info" data-mapinfo>Tap a water tile to chart a course.</span>
            <button class="helm-map-btn ghost" data-mapclear>CLEAR</button>
            <button class="helm-map-btn" data-mapgo disabled>GET UNDERWAY</button>
          </div>
        </div>
      </div>
    </div>`;

  const root = mount.querySelector('.helm-root');
  const q = (s) => root.querySelector(s);
  const sea = q('.helm-chase');

  const ctrl = openHelmChase(sea, {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0, heading: opts.heading ?? 0, sky: opts.sky,
    onArrive: (gx, gy) => { q('[data-pos]').textContent = gx + ' · ' + gy; },
  });

  // Fixed layout — the helm is desktop-only and size-agnostic. The console is a PHYSICAL object at ONE
  // fixed size (--hs) that never morphs with the pane; it reads correctly at any panel size and in
  // fullscreen because the windowed dash is fully TRANSPARENT (only the frosted instrument wings +
  // telegraph carry their own glass), so it never buries the Echelon no matter how short the pane.
  // The chase view always fills the whole pane (full render height, so the hull keeps its true 3D
  // proportions), with the dash floating over its bottom edge. The camera pitch is a FIXED elevated
  // chase angle — the eye rides up-and-over her stern looking DOWN onto the deck, so the hull sits in
  // the water band off the horizon, clear of both the dash and the centred wheel; azimuth-only orbit,
  // no vertical tilt, so she frames the same in every panel state. (Mobile gets its own interface.)
  root.style.setProperty('--hs', '0.92');
  ctrl.setRestPitch(0.58);

  // Keep the Echelon framed at any pane size. The renderer pins her near a fixed screen fraction just
  // off the horizon; the transparent console rises from the bottom over the water. When the pane is short
  // (the console riding high in the frame, little clear water above it) the hull gets crowded down behind
  // the dash — so pull the chase camera proportionally FARTHER BACK, shrinking her to keep the whole ship
  // inside the water band above the console. A roomy/fullscreen pane eases back to the resting frame.
  // Keeping her a constant fraction of the visible water band means zoom ∝ 1/band; calibrated so the
  // resting distance (BASE_ZOOM, = REST.zoom in helm-view) frames her well at a comfortable ~REF-tall band.
  const BASE_ZOOM = 1.7, REF_BAND = 340;   // px — the water-band height at which the resting distance is right
  function fitCamera() {
    const paneH = root.clientHeight, consoleEl = q('.helm-console');
    if (!paneH || !consoleEl) return;
    const band = Math.max(40, paneH - consoleEl.offsetHeight);   // clear water above the console lip
    const z = Math.max(BASE_ZOOM, Math.min(2.4, BASE_ZOOM * REF_BAND / band));   // only ever pull BACK from the resting frame
    ctrl.setRestZoom(z);
  }
  const fitRO = new ResizeObserver(() => fitCamera());
  fitRO.observe(root);
  fitCamera();
  // Dev tuning handle: from the browser console you can dial the resting chase framing live —
  //   __helmCtrl.setPose({ yaw: 34, pitch: 0.16, zoom: 1.7 })   // then read __helmCtrl.pose()
  // Find the framing you like, tell me the numbers, and I bake them into REST (helm-view.js).
  window.__helmCtrl = ctrl;
  if (opts.sky) ctrl.setSky(opts.sky);   // seed the real sim weather field immediately
  if (opts.map) ctrl.setWorld(opts.map, opts.gx, opts.gy);   // frame her against the REAL basin, not blank ocean

  // The wheel is a DIRECTION control: its spin steers the demanded course by that much (clockwise =
  // right, counter-clockwise = left) and she swings slowly toward it; the hub needle reads her actual
  // heading as she comes round.
  // Grabbing the wheel to steer by hand overrides any course armed from the chart — so the telegraph
  // then does a plain direction-sail on the wheel's heading, not the stale plotted course.
  const wheel = createHelmWheel(q('.helm-wheel'), { accent, gear: 8, onSteer: (deg) => { if (plannedTarget) clearCourse(); ctrl.steerBy(deg); }, getHeading: () => ctrl.heading() });

  // ── NAV chart — a live top-down basin scope drawn from the chase view's own world window
  // (ctrl.mapSnapshot): land/piers slate, water the dark teal ground, the Echelon a cyan chevron
  // held at centre (the chart slides under her as she makes way) with range rings + a radar sweep.
  const navCanvas = q('[data-nav]'), navCtx = navCanvas.getContext('2d');
  let navAlive = true, navRaf = 0;
  function drawNav(now) {
    if (!navAlive) return;
    navRaf = requestAnimationFrame(drawNav);
    const snap = ctrl.mapSnapshot?.(); if (!snap || !navCtx) return;
    const box = navCanvas.getBoundingClientRect(); if (!box.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (navCanvas.width !== W || navCanvas.height !== H) { navCanvas.width = W; navCanvas.height = H; }
    navCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height, cx = w / 2, cy = h / 2;
    navCtx.clearRect(0, 0, w, h);
    const rows = snap.rows || [], N = rows.length || 1;
    const cw = w / N, ch = h / N;
    // Sub-tile glide: shift the whole chart against the direction of travel so the blip stays put.
    const sx = (snap.sub ? -snap.sub.x : 0) * cw, sy = (snap.sub ? -snap.sub.y : 0) * ch;
    for (let ry = 0; ry < N; ry++) {
      const row = rows[ry] || [];
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx]; if (!c || c.mark === 'yacht') continue;
        if (c.biome === 'water' || !c.biome) continue;   // water = the scope's own teal bed
        navCtx.fillStyle = c.bt ? '#3a4650' : (c.road ? '#2b343d' : '#232b33');   // buildings > roads > land
        navCtx.fillRect(rx * cw + sx - 0.5, ry * ch + sy - 0.5, cw + 1, ch + 1);
      }
    }
    // Range rings + centre cross.
    navCtx.strokeStyle = acc(0.16); navCtx.lineWidth = 1;
    for (const r of [h * 0.22, h * 0.42]) { navCtx.beginPath(); navCtx.arc(cx, cy, r, 0, 7); navCtx.stroke(); }
    navCtx.beginPath(); navCtx.moveTo(cx - 5, cy); navCtx.lineTo(cx + 5, cy); navCtx.moveTo(cx, cy - 5); navCtx.lineTo(cx, cy + 5); navCtx.stroke();
    // Radar sweep — a fading wedge rotating clockwise.
    const sweep = ((now || 0) * 0.0011) % (Math.PI * 2);
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate(sweep);
    const grad = navCtx.createLinearGradient(0, 0, h * 0.5, 0);
    grad.addColorStop(0, acc(0.26)); grad.addColorStop(1, acc(0));
    navCtx.fillStyle = grad; navCtx.beginPath(); navCtx.moveTo(0, 0); navCtx.arc(0, 0, h * 0.5, -0.32, 0); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
    // Charted (planned, dashed cyan) or active (solid green) course, mirroring the popup chart.
    const navLine = snap.path || snap.plannedPath;
    if (navLine && navLine.length >= 2) {
      navCtx.strokeStyle = snap.path ? grn(0.9) : acc(0.85);
      navCtx.lineWidth = 1.4; navCtx.setLineDash(snap.path ? [] : [3, 3]); navCtx.lineJoin = 'round';
      navCtx.beginPath(); navLine.forEach(([ax, ay], i) => { const x = cx + (ax - snap.gx) * cw + sx, y = cy + (ay - snap.gy) * ch + sy; i ? navCtx.lineTo(x, y) : navCtx.moveTo(x, y); }); navCtx.stroke();
      navCtx.setLineDash([]);
    }
    // Own-ship blip — a glowing cyan chevron pointing along her heading.
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate((snap.heading || 0) * Math.PI / 180);
    navCtx.fillStyle = accLite; navCtx.shadowColor = accent; navCtx.shadowBlur = snap.sailing ? 10 : 6;
    navCtx.beginPath(); navCtx.moveTo(0, -6.5); navCtx.lineTo(4.5, 5.5); navCtx.lineTo(0, 2.5); navCtx.lineTo(-4.5, 5.5); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
  }
  navRaf = requestAnimationFrame(drawNav);

  // ── Heading strip — a compass tape under the lubber showing all eight rhumbs. It rides the boat's
  // actual heading (marks slide as she comes about); the notch the wheel is locked into lights up so
  // you can see when you're "in the notch", and the fixed centre lubber turns green the instant she's
  // settled on it and free to make way (readyDir) — the "you can go now" cue.
  const stripCanvas = q('[data-strip]'), stripCtx = stripCanvas.getContext('2d');
  const STRIP_MARKS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  let stripAlive = true, stripRaf = 0;
  function drawStrip() {
    if (!stripAlive) return;
    stripRaf = requestAnimationFrame(drawStrip);
    const box = stripCanvas.getBoundingClientRect(); if (!box.width || !stripCtx) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (stripCanvas.width !== W || stripCanvas.height !== H) { stripCanvas.width = W; stripCanvas.height = H; }
    stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height, cx = w / 2;
    stripCtx.clearRect(0, 0, w, h);
    // Glass bed + hairline frame.
    stripCtx.fillStyle = 'rgba(8,13,18,0.62)'; stripCtx.fillRect(0, 0, w, h);
    stripCtx.strokeStyle = acc(0.22); stripCtx.lineWidth = 1; stripCtx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const heading = ((ctrl.heading() % 360) + 360) % 360;
    const locked = ctrl.lockedDir?.() || null;   // notch the wheel is seated in (lit mark)
    const ready = ctrl.readyDir?.() || null;      // seated AND come round → green lubber
    const WIN = 70, pxDeg = (w / 2) / WIN;        // ±70° of tape visible across the strip
    stripCtx.textAlign = 'center'; stripCtx.textBaseline = 'middle';
    for (const [lab, deg] of STRIP_MARKS) {
      const off = ((deg - heading + 540) % 360) - 180;   // signed angle from the centred heading
      if (Math.abs(off) > WIN) continue;
      // x = cx − off·px (NOT +): as she turns to starboard (heading climbing, the wheel spun right)
      // the marks slide RIGHT, and to port they slide LEFT — the tape tracks the wheel's own hand.
      const x = cx - off * pxDeg, lit = locked === lab;
      stripCtx.strokeStyle = lit ? accLite : 'rgba(150,170,185,0.5)'; stripCtx.lineWidth = lit ? 2 : 1;
      stripCtx.beginPath(); stripCtx.moveTo(x, h * 0.14); stripCtx.lineTo(x, h * 0.42); stripCtx.stroke();
      stripCtx.font = `700 ${Math.round(h * 0.34)}px 'DejaVu Sans Mono',monospace`;
      if (lit) { stripCtx.fillStyle = accLite; stripCtx.shadowColor = accent; stripCtx.shadowBlur = 10; }
      else { stripCtx.fillStyle = 'rgba(150,170,185,0.6)'; stripCtx.shadowBlur = 0; }
      stripCtx.fillText(lab, x, h * 0.72); stripCtx.shadowBlur = 0;
    }
    // Fixed centre lubber — green (go) when she's ready, accent otherwise.
    stripCtx.fillStyle = ready ? accentGreen : accent;
    stripCtx.beginPath(); stripCtx.moveTo(cx, 2); stripCtx.lineTo(cx - 4, h * 0.2); stripCtx.lineTo(cx + 4, h * 0.2); stripCtx.closePath(); stripCtx.fill();
  }
  stripRaf = requestAnimationFrame(drawStrip);

  // ── Engine telegraph (a real variable throttle) ───────────────────────────────
  // The knob's HEIGHT is the bell: push it up to get underway, and the higher you push the harder she
  // steams — a bigger boiling wake AND a shorter passage (the server scales trip time by the bell, so
  // Full Ahead reaches the same tile in a fraction of a Dead-Slow passage). It holds where you set it
  // while under way and springs to STOP the moment she arrives.
  const tele = q('[data-tele]'), knob = q('[data-knob]'), track = q('.helm-tele-track'), teleLabel = q('[data-telelabel]');
  const KNOBH = 44, PAD = 8;
  const MS_PER_TILE = () => 2500;   // single speed (slow == fast), mirrors the server (local placeholder timing only)
  const cruiseFor = (t) => 0.35 + 0.65 * t;                // mirrors the server's visual bell (wake/water/knots)
  const throttleFor = (c) => Math.max(0, Math.min(1, (c - 0.35) / 0.65));   // invert: cruise → knob position
  const bellName = (p) => p < 0.34 ? 'Dead Slow' : p < 0.67 ? 'Half Ahead' : 'Full Ahead';
  let knobP = 0, teleDrag = false, engaged = false, dragStartP = 0;
  // An armed charted course from the chart popup: { gx, gy } absolute destination. While armed, pushing
  // the telegraph steams the whole pathfound course (sailto) instead of the wheel's locked direction.
  let plannedTarget = null;
  const setKnob = (p) => { knobP = Math.max(0, Math.min(1, p)); const rng = track.clientHeight - KNOBH - PAD * 2; knob.style.top = (PAD + (1 - knobP) * rng) + 'px'; };
  function setUnderway(on) {
    engaged = on; tele.classList.toggle('engaged', on); wheel.setEnabled(!on);
    teleLabel.textContent = on ? ('Ahead — ' + bellName(knobP)) : 'Engine Telegraph';
    if (!on) setKnob(0);   // arrived / moored / stopped → lever springs back to STOP (engaging leaves it where set)
  }
  // Cut the throttle mid-passage: fire the real `stop` (the server halts her at the tile she's coasted
  // to and confirms via helm_arrived) and freeze the local glide at once so the boat responds instantly.
  function cutThrottle() {
    ctrl.stopHere?.();      // freeze the local glide now; the server's helm_arrived re-centres authoritatively
    setUnderway(false);     // lever springs back to STOP, wheel unlocks
    onStop();               // fire the real `stop` in game
  }
  // Steam an armed charted course: fire the real `sailto`, and optimistically begin the local glide
  // along the previewed path so the chase view moves at once (the server's helm_underway corrects it).
  function engageCourse(bellFrac) {
    if (!plannedTarget) return;
    const t = Math.max(0.15, Math.min(1, bellFrac));
    const target = plannedTarget, plan = ctrl.plannedCourse();
    // Optimistic UI FIRST, then the network send — so the throttle/boat respond instantly and a hiccup
    // in the send can't leave them frozen (the server's helm_underway just corrects the local glide).
    setKnob(t);
    if (plan && plan.length >= 2) {
      const dir = dirLetter(plan[1][0] - plan[0][0], plan[1][1] - plan[0][1]);
      const estMs = (plan.length - 1) * 5000;   // course pace (5 s/leg); server confirms exact ms via helm_underway
      ctrl.beginTransit(dir, estMs, estMs, plan.length - 1, cruiseFor(t), plan);
    }
    plannedTarget = null; tele.classList.remove('course');
    setUnderway(true);
    closeChart();
    onSailTo(target.gx, target.gy, Math.round(t * 100));
  }
  function tryEngage() {
    // A charted course wins: the map has already picked the heading, so steam it regardless of the wheel.
    if (plannedTarget) { engageCourse(Math.max(0.15, knobP)); return; }
    const dir = ctrl.readyDir();
    if (!dir) { setKnob(0); tele.classList.add('warn'); teleLabel.textContent = 'Steady the helm'; setTimeout(() => { tele.classList.remove('warn'); if (!engaged) teleLabel.textContent = 'Engine Telegraph'; }, 1400); return; }
    const t = Math.max(0, Math.min(1, knobP));
    const estMs = MS_PER_TILE(t);   // one-tile manual nudge; the server's helm_underway confirms real ms/cruise, or helm_hold cancels if land is immediately ahead
    ctrl.beginTransit(dir, estMs, estMs, 1, cruiseFor(t));   // local placeholder (1 tile) matching the server's direct-sail; a hold is fixed at once by helm_hold
    onSail(dir, Math.round(t * 100));                        // fire the real `sail <dir> <bell%>` in game
    setUnderway(true);
  }
  // The lever is now grabbable even while underway — but the ONLY thing you can do mid-passage is haul
  // it back to STOP to cut the throttle. You can't re-bell a running passage (the server's pace is
  // fixed), so a drag that doesn't reach the STOP band just snaps the lever back where it was.
  const teleDown = (e) => { teleDrag = true; dragStartP = knobP; knob.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const teleMove = (e) => { if (!teleDrag) return; const r = track.getBoundingClientRect(); setKnob(1 - (e.clientY - r.top - KNOBH / 2) / (r.height - KNOBH));
    teleLabel.textContent = engaged ? (knobP <= 0.2 ? 'Cut throttle — All Stop' : 'Ahead — ' + bellName(knobP)) : (knobP > 0.2 ? bellName(knobP) : 'Engine Telegraph'); };
  const teleUp = () => {
    if (!teleDrag) return; teleDrag = false;
    if (engaged) { if (knobP <= 0.2) cutThrottle(); else setKnob(dragStartP); return; }   // underway: down-to-STOP cuts the throttle; anything else restores the lever
    if (knobP > 0.2) tryEngage(); else setKnob(0);
  };
  knob.addEventListener('pointerdown', teleDown);
  addEventListener('pointermove', teleMove); addEventListener('pointerup', teleUp);
  setKnob(0);

  // ── Chart popup — a tablet-styled basin map you tap to plot a course around the shoreline ──
  // Client-side A* over the visible world window gives an instant course preview; engaging it fires
  // the real `sailto`, and the server re-charts authoritatively (its path corrects the local glide).
  const mapOverlay = q('[data-map]'), mapCanvas = q('[data-mapc]'), mapCtx = mapCanvas.getContext('2d');
  const mapInfo = q('[data-mapinfo]'), mapGoBtn = q('[data-mapgo]'), mapClearBtn = q('[data-mapclear]');
  let mapOpen = false, mapRaf = 0, mapHover = null;
  const NB8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // STRICT navigable water: only a real water-biome cell counts. The old test also accepted a cell
  // with NO biome (`|| !c.biome`), which let the course A* route the hull across off-map "air" edge
  // cells and any untagged land — that's what put her sailing through the city. She may only make way
  // over genuine open water (never a building tile), so the course can never leave the basin.
  const cellWater = (rows, rx, ry) => { const c = rows[ry] && rows[ry][rx]; return !!(c && c.biome === 'water' && !c.bt); };
  function previewCourse(rows, sx, sy, tx, ty) {
    const N = rows.length;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N || !cellWater(rows, tx, ty) || (sx === tx && sy === ty)) return null;
    const key = (x, y) => x * N + y;
    const heur = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const start = { x: sx, y: sy, g: 0, parent: null }; start.f = heur(sx, sy);
    const open = new Map([[key(sx, sy), start]]), closed = new Set(); let count = 0;
    while (open.size) {
      let cur = null; for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
      open.delete(key(cur.x, cur.y));
      if (cur.x === tx && cur.y === ty) { const p = []; for (let n = cur; n; n = n.parent) p.push([n.x, n.y]); return p.reverse(); }
      closed.add(key(cur.x, cur.y));
      if (++count > 4000) return null;
      for (const [dx, dy] of NB8) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || closed.has(key(nx, ny)) || !cellWater(rows, nx, ny)) continue;
        if (dx && dy && (!cellWater(rows, cur.x + dx, cur.y) || !cellWater(rows, cur.x, cur.y + dy))) continue;
        const g = cur.g + (dx && dy ? Math.SQRT2 : 1);
        const ex = open.get(key(nx, ny)); if (ex && ex.g <= g) continue;
        const node = { x: nx, y: ny, g, parent: cur }; node.f = g + heur(nx, ny);
        open.set(key(nx, ny), node);
      }
    }
    return null;
  }
  function openChart() { if (ctrl.isBusy() || ctrl.isSailing()) return; mapOpen = true; mapOverlay.classList.add('open'); if (!mapRaf) mapRaf = requestAnimationFrame(drawChart); }
  function closeChart() { mapOpen = false; mapOverlay.classList.remove('open'); cancelAnimationFrame(mapRaf); mapRaf = 0; }
  function armCourse(abs) {
    const dest = abs[abs.length - 1];
    plannedTarget = { gx: dest[0], gy: dest[1] };
    ctrl.setPlannedCourse(abs); tele.classList.add('course'); mapGoBtn.disabled = false;
    mapInfo.innerHTML = `Course charted — <b>${abs.length - 1}</b> legs to <b>${dest[0]} · ${dest[1]}</b>. Get underway, or push the telegraph.`;
  }
  function clearCourse() {
    plannedTarget = null; ctrl.setPlannedCourse(null); tele.classList.remove('course');
    mapGoBtn.disabled = true; mapInfo.textContent = 'Tap a water tile to chart a course.';
  }
  const cellFromEvent = (e) => {
    const snap = ctrl.mapSnapshot?.(); if (!snap) return null;
    const rows = snap.rows || [], N = rows.length || 1, r = mapCanvas.getBoundingClientRect();
    const rx = Math.floor((e.clientX - r.left) / (r.width / N)), ry = Math.floor((e.clientY - r.top) / (r.height / N));
    if (rx < 0 || ry < 0 || rx >= N || ry >= N) return null;
    return { rx, ry, rows, N, c: (N - 1) / 2, gx: snap.gx, gy: snap.gy };
  };
  function drawChart(now) {
    if (mapOpen) mapRaf = requestAnimationFrame(drawChart);
    const snap = ctrl.mapSnapshot?.(); if (!snap || !mapCtx) return;
    const box = mapCanvas.parentElement.getBoundingClientRect(); if (!box.width) return;
    const side = Math.min(box.width - 32, 440), dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(2, Math.round(side * dpr));
    if (mapCanvas.width !== W || mapCanvas.height !== W) { mapCanvas.width = W; mapCanvas.height = W; mapCanvas.style.height = side + 'px'; }
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = side, h = side, rows = snap.rows || [], N = rows.length || 1, cen = (N - 1) / 2, cw = w / N, ch = h / N;
    mapCtx.clearRect(0, 0, w, h);
    for (let ry = 0; ry < N; ry++) { const row = rows[ry] || []; for (let rx = 0; rx < row.length; rx++) {
      const cell = row[rx];
      // Navigable water is the bright teal bed you may plot into; land/shore/off-map are drawn dark
      // and then scrimmed so the water region reads as the ONLY live area — the "boundary" is the
      // coastline itself. An absent (off-map) cell falls through to the scrim over bare black.
      const water = cellWater(rows, rx, ry);
      if (water) { mapCtx.fillStyle = '#06222b'; }
      else if (cell) { mapCtx.fillStyle = cell.bt ? '#2c343d' : (cell.road ? '#232b33' : '#1b222a'); }
      else { mapCtx.fillStyle = '#0a0d11'; }
      mapCtx.fillRect(rx * cw, ry * ch, cw + 0.6, ch + 0.6);
      if (!water) { mapCtx.fillStyle = 'rgba(2,5,8,0.5)'; mapCtx.fillRect(rx * cw, ry * ch, cw + 0.6, ch + 0.6); }   // out-of-bounds scrim
    } }
    const toXY = (ax, ay) => [(cen + (ax - snap.gx) + 0.5) * cw, (cen + (ay - snap.gy) + 0.5) * ch];
    // Hover highlight (only on navigable water).
    if (mapHover && cellWater(rows, mapHover.rx, mapHover.ry)) {
      mapCtx.strokeStyle = acc(0.7); mapCtx.lineWidth = 1.5;
      mapCtx.strokeRect(mapHover.rx * cw + 0.5, mapHover.ry * ch + 0.5, cw - 1, ch - 1);
    }
    // Charted (planned) or active course polyline.
    const line = snap.path || snap.plannedPath;
    if (line && line.length >= 2) {
      mapCtx.strokeStyle = snap.path ? grn(0.95) : acc(0.9);
      mapCtx.lineWidth = 2; mapCtx.setLineDash(snap.path ? [] : [5, 4]); mapCtx.lineJoin = 'round';
      mapCtx.beginPath(); line.forEach(([ax, ay], i) => { const [x, y] = toXY(ax, ay); i ? mapCtx.lineTo(x, y) : mapCtx.moveTo(x, y); }); mapCtx.stroke();
      mapCtx.setLineDash([]);
      const [dx, dy] = toXY(line[line.length - 1][0], line[line.length - 1][1]);
      mapCtx.fillStyle = snap.path ? accentGreen : accLite; mapCtx.beginPath(); mapCtx.arc(dx, dy, 4, 0, 7); mapCtx.fill();
    }
    // Own-ship chevron at centre, along heading.
    const [ox, oy] = toXY(snap.gx + (snap.sub ? snap.sub.x : 0), snap.gy + (snap.sub ? snap.sub.y : 0));
    mapCtx.save(); mapCtx.translate(ox, oy); mapCtx.rotate((snap.heading || 0) * Math.PI / 180);
    mapCtx.fillStyle = accLite; mapCtx.shadowColor = accent; mapCtx.shadowBlur = 8;
    mapCtx.beginPath(); mapCtx.moveTo(0, -8); mapCtx.lineTo(5.5, 7); mapCtx.lineTo(0, 3.5); mapCtx.lineTo(-5.5, 7); mapCtx.closePath(); mapCtx.fill();
    mapCtx.restore();
  }
  mapCanvas.addEventListener('pointermove', (e) => { const cell = cellFromEvent(e); mapHover = cell ? { rx: cell.rx, ry: cell.ry } : null; });
  mapCanvas.addEventListener('pointerleave', () => { mapHover = null; });
  mapCanvas.addEventListener('click', (e) => {
    // The chart is water-only: a pick off the map or on land/shore can't be a destination. Reject it
    // with a specific reason instead of silently doing nothing, so it's clear you must choose water.
    const cell = cellFromEvent(e);
    if (!cell) { clearCourse(); mapInfo.textContent = 'Off the chart — tap open water inside the basin.'; return; }
    if (!cellWater(cell.rows, cell.rx, cell.ry)) { clearCourse(); mapInfo.textContent = 'That is dry land — the Echelon can only make way over open water.'; return; }
    const path = previewCourse(cell.rows, cell.c, cell.c, cell.rx, cell.ry);
    if (!path) { clearCourse(); mapInfo.textContent = 'No navigable channel to that tile — pick open water clear of the shore.'; return; }
    armCourse(path.map(([rx, ry]) => [cell.gx + (rx - cell.c), cell.gy + (ry - cell.c)]));
  });
  q('[data-mapclose]').addEventListener('click', closeChart);
  mapOverlay.addEventListener('pointerdown', (e) => { if (e.target === mapOverlay) closeChart(); });
  mapClearBtn.addEventListener('click', clearCourse);
  mapGoBtn.addEventListener('click', () => engageCourse(Math.max(knobP, 0.6)));
  root.querySelectorAll('[data-chart]').forEach(el => el.addEventListener('click', openChart));

  // Orbit / zoom on the sea — the chase cam stays fixed on the boat and arcs around it.
  let drag = false, lx = 0, ly = 0;
  sea.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; sea.setPointerCapture?.(e.pointerId); });
  sea.addEventListener('pointermove', (e) => { if (!drag) return; ctrl.orbit((e.clientX - lx) * 0.4); lx = e.clientX; ly = e.clientY; });   // azimuth-only dome orbit (no vertical tilt)
  const upH = () => { drag = false; }; addEventListener('pointerup', upH);
  sea.addEventListener('wheel', (e) => { e.preventDefault(); ctrl.zoom(e.deltaY > 0 ? 0.08 : -0.08); }, { passive: false });

  // Fullscreen — the SAME body-class mechanism the flight sim uses (styles.css): the helm grows to
  // fill the output column (⛶ also folds the command box) instead of an OS-fullscreen overlay. Cleared
  // on close.
  const fsBtn = q('[data-fs]');
  fsBtn.addEventListener('click', () => { const on = document.body.classList.toggle('helm-fullscreen'); fsBtn.classList.toggle('on', on); fitCamera(); });
  q('[data-exit]').addEventListener('click', () => { closeHelm(); onExit(); });

  // Keyboard: Esc exits. (Course is the wheel; the throttle is the telegraph — both are grab-and-drag.)
  const keyH = (e) => { if (e.key === 'Escape') { closeHelm(); onExit(); } };
  addEventListener('keydown', keyH);

  // Restore an in-progress passage (helm opened mid-transit): lock + run out the remaining time,
  // seeding true progress from the full passage length so the world resumes part-slid (not from 0).
  if (opts.transitMs > 0) { if (opts.cruise > 0) setKnob(throttleFor(opts.cruise)); ctrl.beginTransit(HDG_TO_DIR[((Math.round(opts.heading || 0) % 360) + 360) % 360] || 'N', opts.transitMs, opts.transitTotal || opts.transitMs, opts.transitTiles || 1, opts.cruise); setUnderway(true); }

  // Live readouts (heading eases + the passage runs on a timer, so poll). The telegraph/wheel lock
  // tracks her actual under-way state, so a server-driven begin/arrive keeps the console in sync.
  let wasSailing = engaged;
  const poll = setInterval(() => {
    const h = ((Math.round(ctrl.heading()) % 360) + 360) % 360;
    q('[data-hdg]').textContent = CARD[h] ?? (h + '°');
    q('[data-kn]').textContent = (ctrl.speed() * 20).toFixed(1);
    const snap = ctrl.mapSnapshot?.();
    if (snap) {
      // Her committed tile (snap.gx/gy) stays on the DEPARTURE tile until she arrives, so add the live
      // sub-tile glide (snap.sub) to it — POSITION then counts toward the destination as she crosses,
      // instead of sitting frozen on the departure tile for the whole passage (read as "not moving").
      const px = Math.round(snap.gx + (snap.sub ? snap.sub.x : 0));
      const py = Math.round(snap.gy + (snap.sub ? snap.sub.y : 0));
      q('[data-pos]').textContent = px + ' · ' + py;
    }
    const sailing = ctrl.isSailing();
    if (sailing !== wasSailing) { if (sailing) setKnob(throttleFor(ctrl.cruise())); setUnderway(sailing); wasSailing = sailing; }
    const left = ctrl.transitLeft();
    q('[data-eta]').textContent = left > 0 ? fmtETA(left) : '—';
    q('.helm-readout.eta').classList.toggle('idle', left <= 0);
    const busy = ctrl.isBusy();
    q('[data-status]').textContent = sailing ? 'MAKING WAY' : (busy ? 'COMING ABOUT' : 'MOORED');
    q('.helm-readout.st').classList.toggle('busy', busy);
    const env = ctrl.env?.();   // live world time/weather for the chips
    if (env) { q('[data-time]').textContent = env.time; q('[data-wx]').textContent = (env.weather || 'clear').toUpperCase(); }
  }, 100);

  _helm = { mount, ctrl, wheel, poll, upH, keyH, teleMove, teleUp, fitRO, stopChart: closeChart, stopNav: () => { navAlive = false; cancelAnimationFrame(navRaf); stripAlive = false; cancelAnimationFrame(stripRaf); } };
  return { ctrl, wheel, close: () => { closeHelm(); onExit(); }, setPosition: (gx, gy) => ctrl.setPosition(gx, gy), setHeading: (h) => ctrl.setHeading(h), setSky: (sky) => ctrl.setSky(sky) };
}

export function closeHelm() {
  if (!_helm) return;
  const h = _helm; _helm = null;
  clearInterval(h.poll);
  removeEventListener('pointerup', h.upH);
  removeEventListener('keydown', h.keyH);
  removeEventListener('pointermove', h.teleMove);
  removeEventListener('pointerup', h.teleUp);
  try { h.fitRO?.disconnect(); } catch {}
  try { h.stopNav?.(); } catch {}
  try { h.stopChart?.(); } catch {}
  document.body.classList.remove('helm-fullscreen', 'helm-hidepanel');
  try { h.wheel?.destroy(); } catch {}
  try { h.ctrl?.destroy(); } catch {}
  try { if (window.__helmCtrl === h.ctrl) delete window.__helmCtrl; } catch {}
  if (h.mount) h.mount.innerHTML = '';
}
