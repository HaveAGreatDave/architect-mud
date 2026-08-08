// CARD MACHINE + PACK OPENING — the vending terminal and the foil-tear reveal.
//
// Two overlays, deliberately separate, because they are two different moments.
// The MACHINE is a thing you stand in front of and press buttons on — and it is
// deliberately NOT the shared minigame CRT chassis every other device in the game
// wears. A card machine is a vending cabinet: a lit marquee, product on coils
// behind real glass, an odds board, and a delivery flap that gets hit. No
// scanlines, because there is no tube in it. The REVEAL is a thing that happens
// to you: fullscreen, no chrome, no controls but "next".
//
// THE RULE THIS MODULE IS BUILT AROUND: the client decides nothing. Every card,
// its rarity, whether it's a dupe and the fully-rendered face all arrive from the
// server in the `cardpack_open` payload (plugins/cards/index.js). This file owns
// PACING and PRESENTATION only. That matters more here than in most panels — a
// reveal is the one place a player would be quickest to suspect the animation of
// choosing the outcome, and it can't, because the outcome was decided and granted
// before the first frame drew.
//
// The text log always lands alongside the overlay, so closing this mid-reveal
// costs the player nothing but the show.
import { sendCmd, sendCmdSilent } from '../net.js';
import { refreshInventory } from './inventory-state.js';
import { sfx, esc, mountOverlay } from './minigame-common.js';
import { prefersReducedMotion } from '/shared/settings.js';

// ── the rarity ladder, as presentation ────────────────────────────────────────
// One table drives colour, ray count, screen flash, the pre-flip HOLD and the
// post-flip DWELL. Keeping them in one row per rank is what stops the ladder
// going ragged — you can read straight down it and see that every rung is more
// than the one below on every axis, which is the property the whole reveal
// depends on and the easiest one to break by tuning a single case in isolation.
//
// `hold` is the pause between the card arriving and it flipping. It is the
// suspense, and it is also literally the SFX riser: cards-flip-legendary spends
// its first 440ms climbing, so a legendary's 460ms hold means the chord lands on
// the same frame the face does.
//
// `dwell` is no longer an auto-advance timer — it is the SHIMMER BUDGET, the
// window the card's own lines have to light up one after another before the
// reveal is considered finished. Nothing takes the card away at the end of it:
// see AUTO_MS.
const RARITY = {
  common:    { color: '#8b98a8', glow: 0.15, rays: 0,  flash: 0,    shake: 0,    hold: 140, dwell: 1400, sfx: 'cards-flip-common',    label: 'COMMON' },
  uncommon:  { color: '#57d47c', glow: 0.3,  rays: 0,  flash: 0.08, shake: 0,    hold: 200, dwell: 1800, sfx: 'cards-flip-uncommon',  label: 'UNCOMMON' },
  rare:      { color: '#4aa8ff', glow: 0.5,  rays: 10, flash: 0.16, shake: 0.25, hold: 340, dwell: 2600, sfx: 'cards-flip-rare',      label: 'RARE' },
  epic:      { color: '#b374ff', glow: 0.72, rays: 16, flash: 0.3,  shake: 0.55, hold: 470, dwell: 3400, sfx: 'cards-flip-epic',      label: 'EPIC' },
  legendary: { color: '#ffc23d', glow: 1,    rays: 24, flash: 0.5,  shake: 1,    hold: 640, dwell: 4200, sfx: 'cards-flip-legendary', label: 'LEGENDARY' },
  architect: { color: '#ff5470', glow: 1,    rays: 28, flash: 0.6,  shake: 1,    hold: 740, dwell: 4600, sfx: 'cards-flip-architect', label: 'ARCHITECT' },
};

// THE CARD WAITS FOR YOU. Fifteen seconds, the same for every rank, and a click
// takes it early. The old behaviour auto-advanced after the rarity's own dwell —
// under a second and a half on a Common — which meant the pacing decided how long
// you were allowed to look at your own card, and a player who wanted to actually
// READ one had to race it. A generous flat timer inverts that: the reveal is
// paced by its animation, and the card is dismissed by the person holding it.
const AUTO_MS = 15000;
const rarity = r => RARITY[r] || RARITY.common;

// A rare-or-better pull earns the full treatment: rays, flash, a held beat. Below
// that the card just turns over — which is the point. If a Common got confetti,
// a Legendary would have nothing left to be.
const isBig = r => (RARITY[r]?.rays || 0) > 0;

// ── styles ────────────────────────────────────────────────────────────────────
// Injected once rather than living in styles.css, following the minigame overlays:
// this is a self-contained fullscreen cinematic and nothing else in the client
// styles against it.
function ensurePackStyles() {
  if (document.getElementById('cardpack-styles')) return;
  const s = document.createElement('style');
  s.id = 'cardpack-styles';
  s.textContent = `
  /* ── the reveal overlay ───────────────────────────────────────────────── */
  #cardpack-overlay { position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 45%, rgba(14,20,30,0.86), rgba(2,4,7,0.97) 70%);
    backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); overflow:hidden;
    font-family:'Courier New', monospace; user-select:none; }
  #cardpack-overlay .cp-stage { position:relative; width:min(94vw,760px); height:min(88vh,640px);
    display:flex; align-items:center; justify-content:center; }

  /* Ambient rake of light behind everything, tinted by the current card. */
  #cardpack-overlay .cp-ambient { position:absolute; inset:-40%; pointer-events:none; opacity:0;
    background:radial-gradient(circle at 50% 50%, var(--cp-accent,#fff) 0%, transparent 62%);
    transition:opacity .45s ease; mix-blend-mode:screen; }

  /* ── the sealed sleeve ────────────────────────────────────────────────── */
  .cp-pack { position:relative; width:230px; height:330px; cursor:pointer;
    transform-origin:50% 55%; animation:cp-pack-idle 3.4s ease-in-out infinite; }
  .cp-pack-body { position:absolute; inset:0; border-radius:8px; overflow:hidden;
    background:linear-gradient(148deg,#12212e 0%,#20455c 18%,#7fd8e8 33%,#2a5f7a 44%,#123044 58%,#6b52a8 72%,#2b2352 84%,#101a2a 100%);
    box-shadow:0 26px 60px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 0 40px rgba(0,0,0,0.5); }
  /* The holographic sweep: a hard specular band raked across the foil. It is the
     single cue that says "this is foil, not paper" before anything moves. */
  .cp-pack-body::after { content:''; position:absolute; inset:-60%;
    background:linear-gradient(74deg, transparent 38%, rgba(255,255,255,0.72) 47%, rgba(190,255,255,0.9) 50%, rgba(255,255,255,0.6) 53%, transparent 62%);
    animation:cp-holo 2.6s linear infinite; mix-blend-mode:overlay; }
  .cp-pack-print { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:10px; text-align:center; text-shadow:0 2px 8px rgba(0,0,0,0.85); z-index:2; }
  .cp-pack-mark { font-size:40px; color:#eaf6ff; filter:drop-shadow(0 0 12px rgba(140,220,255,0.9)); }
  .cp-pack-brand { font-size:15px; letter-spacing:5px; color:#fff; font-weight:700; }
  .cp-pack-sub { font-size:9px; letter-spacing:3px; color:rgba(230,245,255,0.75); }
  .cp-pack-count { margin-top:14px; font-size:10px; letter-spacing:2px; color:rgba(255,255,255,0.6);
    border-top:1px solid rgba(255,255,255,0.22); border-bottom:1px solid rgba(255,255,255,0.22); padding:5px 12px; }
  /* Scored seam — the thing you are about to tear, so it is drawn as a real
     feature of the object rather than implied by the animation. */
  .cp-pack-seam { position:absolute; left:0; right:0; top:26px; height:12px; z-index:3;
    background:repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 5px, transparent 5px 10px);
    opacity:.55; }
  /* Where it came off. The sealed sleeve remembers its coil, which is the only
     thread between a choice and an outcome — and the seed of every superstition
     a player is ever going to form about this machine. */
  .cp-pack-from { position:absolute; left:0; right:0; bottom:10px; text-align:center; z-index:3;
    font-size:8px; letter-spacing:2px; color:rgba(230,245,255,0.55); text-shadow:0 1px 4px rgba(0,0,0,0.9); }
  .cp-pack-hint { position:absolute; left:50%; bottom:-46px; transform:translateX(-50%); white-space:nowrap;
    font-size:11px; letter-spacing:3px; color:#9fd8ff; animation:cp-blink 1.5s ease-in-out infinite; }

  @keyframes cp-pack-idle { 0%,100%{transform:rotate(-2.2deg) translateY(0)} 50%{transform:rotate(2.2deg) translateY(-10px)} }
  @keyframes cp-holo { from{transform:translateX(-55%)} to{transform:translateX(55%)} }
  @keyframes cp-blink { 0%,100%{opacity:.35} 50%{opacity:1} }

  /* Tearing: the top strip rips free and spins off, the body drops and fades. */
  .cp-pack.tearing { animation:cp-pack-shake .28s ease-in-out 2; }
  .cp-pack.tearing .cp-pack-seam { animation:cp-seam-run .34s linear forwards; }
  /* The seam burns as it runs — light leaking out of the pack before anything
     has come out of it. */
  .cp-stage.tearlight .cp-pack-seam { box-shadow:0 0 18px rgba(150,235,255,0.95), 0 0 44px rgba(120,215,255,0.6);
    background:repeating-linear-gradient(90deg, rgba(255,255,255,0.95) 0 5px, rgba(160,235,255,0.4) 5px 10px); opacity:1; }
  .cp-stage.tearlight .cp-pack-body { box-shadow:0 26px 60px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.16),
    inset 0 22px 50px rgba(150,235,255,0.45); }
  .cp-pack.torn .cp-pack-top { animation:cp-strip-away .8s cubic-bezier(.3,.7,.4,1) forwards; }
  .cp-pack.torn .cp-pack-body, .cp-pack.torn .cp-pack-print { animation:cp-body-drop .8s cubic-bezier(.4,0,.7,1) forwards; }
  .cp-pack-top { position:absolute; left:-4px; right:-4px; top:-4px; height:36px; z-index:4; border-radius:8px 8px 2px 2px;
    background:linear-gradient(148deg,#20455c,#7fd8e8 40%,#2a5f7a);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,0.2); opacity:0; }
  .cp-pack.torn .cp-pack-top { opacity:1; }
  @keyframes cp-pack-shake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-7px) rotate(-2deg)} 75%{transform:translateX(7px) rotate(2deg)} }
  @keyframes cp-seam-run { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
  @keyframes cp-strip-away { to{transform:translate(210px,-190px) rotate(58deg); opacity:0} }
  @keyframes cp-body-drop { to{transform:translateY(150px) scale(.86); opacity:0} }

  /* Foil flecks thrown off the tear. */
  .cp-fleck { position:absolute; width:7px; height:9px; pointer-events:none; z-index:5;
    background:linear-gradient(140deg,#cfeeff,#5aa8c8); border-radius:1px;
    animation:cp-fleck-fly var(--d,1s) cubic-bezier(.15,.6,.4,1) forwards; }
  @keyframes cp-fleck-fly { to{ transform:translate(var(--tx),var(--ty)) rotate(var(--rot)); opacity:0 } }
  /* Gold under the foil — a hot run's only visual tell, and it arrives at the
     tear, never before it. */
  .cp-fleck.gold { background:linear-gradient(140deg,#fff2c0,#e0a52a); box-shadow:0 0 8px rgba(255,200,90,0.8); }

  .cp-hot-banner { position:absolute; left:50%; top:26%; transform:translate(-50%,-50%); z-index:15; text-align:center;
    pointer-events:none; animation:cp-hot-in .5s cubic-bezier(.2,1.6,.4,1) forwards, cp-hot-out .5s ease-in 2.1s forwards; }
  .cp-hot-banner span { display:block; font-size:30px; font-weight:700; letter-spacing:10px; color:#ffd77a;
    text-shadow:0 0 26px rgba(255,190,70,0.95), 0 0 60px rgba(255,150,40,0.6); }
  .cp-hot-banner i { display:block; margin-top:8px; font-style:normal; font-size:10px; letter-spacing:5px; color:#ffe9c0; }
  @keyframes cp-hot-in { from{opacity:0; transform:translate(-50%,-50%) scale(.6)} to{opacity:1; transform:translate(-50%,-50%) scale(1)} }
  @keyframes cp-hot-out { to{opacity:0; transform:translate(-50%,-58%) scale(1.05)} }

  /* ── the card ─────────────────────────────────────────────────────────── */
  .cp-card-wrap { position:relative; width:min(78vw,340px); perspective:1400px; }
  .cp-card { position:relative; width:100%; aspect-ratio:5/7; transform-style:preserve-3d;
    transition:transform .62s cubic-bezier(.3,.9,.3,1); transform:rotateY(180deg) translateY(28px) scale(.9); }
  .cp-card.in { transform:rotateY(180deg) translateY(0) scale(1); }
  .cp-card.flipped { transform:rotateY(0deg); }
  .cp-card-side { position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden;
    border-radius:12px; overflow:hidden; box-shadow:0 22px 55px rgba(0,0,0,0.7); }

  /* Reverse — the Mint's house back. Every card in the game shares it, which is
     what makes the flip mean anything: until it turns, you have no information. */
  .cp-back { transform:rotateY(180deg); background:
      repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 6px, transparent 6px 12px),
      linear-gradient(160deg,#0d1a26,#1d3f57 45%,#0a1420);
    border:1px solid rgba(140,210,255,0.28); display:flex; align-items:center; justify-content:center; }
  .cp-back-mark { font-size:56px; color:rgba(150,225,255,0.5); text-shadow:0 0 26px rgba(90,190,255,0.55); }

  /* Obverse — the server-rendered face, dropped in whole. */
  .cp-front { background:linear-gradient(170deg,#0b1118,#131c26); padding:12px;
    border:1px solid color-mix(in srgb, var(--cp-accent,#fff) 55%, transparent);
    box-shadow:0 0 0 1px rgba(0,0,0,0.6), 0 0 34px color-mix(in srgb, var(--cp-accent,#fff) calc(var(--cp-glow,0) * 60%), transparent);
    overflow-y:auto; }
  .cp-front .card-face { display:block; font-size:12px; line-height:1.5; }

  /* Rank plate under the card. */
  .cp-rank { margin-top:16px; text-align:center; font-size:13px; letter-spacing:6px; font-weight:700;
    color:var(--cp-accent,#fff); text-shadow:0 0 16px color-mix(in srgb, var(--cp-accent,#fff) 70%, transparent);
    opacity:0; transition:opacity .3s ease .12s; }
  .cp-card.flipped ~ .cp-rank { opacity:1; }
  .cp-sub { margin-top:5px; text-align:center; font-size:10px; letter-spacing:2px; color:#7f8f9f; opacity:0;
    transition:opacity .3s ease .2s; }
  .cp-card.flipped ~ .cp-sub { opacity:1; }
  .cp-dupe-tag { color:#c07b3a; }

  /* A PLAYER card is somebody real. It gets a banner no NPC card can earn — the
     asymmetry is the point of the whole system, so it is stated on screen. */
  .cp-player-banner { position:absolute; top:-30px; left:50%; transform:translateX(-50%) scale(.7);
    white-space:nowrap; font-size:10px; letter-spacing:4px; font-weight:700; padding:4px 14px; border-radius:3px;
    color:#04121a; background:linear-gradient(90deg,#7fe8ff,#fff,#7fe8ff); opacity:0;
    box-shadow:0 0 24px rgba(140,230,255,0.8); transition:opacity .35s ease, transform .35s cubic-bezier(.2,1.5,.4,1); }
  .cp-card.flipped ~ .cp-player-banner { opacity:1; transform:translateX(-50%) scale(1); }

  /* Rays — a fixed fan behind the card, scaled per rank by how many spokes exist. */
  .cp-rays { position:absolute; left:50%; top:45%; width:0; height:0; pointer-events:none; z-index:-1; opacity:0; }
  .cp-rays.on { animation:cp-rays-burst 1.5s ease-out forwards; }
  .cp-ray { position:absolute; left:0; top:0; width:3px; height:min(70vh,520px); transform-origin:50% 0;
    background:linear-gradient(180deg, color-mix(in srgb, var(--cp-accent,#fff) 85%, transparent), transparent 68%); }
  @keyframes cp-rays-burst { 0%{opacity:0; transform:scale(.25) rotate(0)} 22%{opacity:.9} 100%{opacity:.22; transform:scale(1) rotate(26deg)} }

  /* Screen flash on the flip — opacity comes from the rarity row, so a Common's
     is literally zero rather than "very small". */
  .cp-flash { position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; z-index:20; }
  .cp-flash.on { animation:cp-flash-hit .5s ease-out forwards; }
  @keyframes cp-flash-hit { 0%{opacity:var(--cp-flash,0)} 100%{opacity:0} }

  .cp-stage.shake { animation:cp-stage-shake .42s cubic-bezier(.36,.07,.19,.97); }
  @keyframes cp-stage-shake { 10%,90%{transform:translateX(calc(-2px * var(--cp-shake,0)))}
    20%,80%{transform:translateX(calc(4px * var(--cp-shake,0)))}
    30%,50%,70%{transform:translateX(calc(-7px * var(--cp-shake,0)))}
    40%,60%{transform:translateX(calc(7px * var(--cp-shake,0)))} }

  /* Shockwave — a ring thrown off the card at the instant it turns. It is the
     single cheapest thing that makes a flip feel like an EVENT rather than a
     transition, and it scales with the rank because it borrows --cp-glow. */
  .cp-ring { position:absolute; left:50%; top:50%; width:220px; height:220px; margin:-110px 0 0 -110px;
    border-radius:50%; pointer-events:none; z-index:7; opacity:0;
    border:2px solid var(--cp-accent,#fff); box-shadow:0 0 26px var(--cp-accent,#fff), inset 0 0 26px var(--cp-accent,#fff); }
  .cp-ring.on { animation:cp-ring-out .78s cubic-bezier(.2,.7,.3,1) forwards; }
  @keyframes cp-ring-out { 0%{opacity:calc(.25 + var(--cp-glow,0) * .6); transform:scale(.35)}
    100%{opacity:0; transform:scale(2.6)} }

  /* Shine — a hard specular band raked across the FACE just after it lands, the
     same cue the sealed foil uses. It is what says the card is a printed,
     laminated object and not a panel of text. */
  .cp-shine { position:absolute; inset:0; pointer-events:none; z-index:8; overflow:hidden; border-radius:12px; }
  .cp-shine i { position:absolute; inset:-70%;
    background:linear-gradient(74deg, transparent 42%, rgba(255,255,255,0.42) 49%, rgba(220,250,255,0.6) 51%, transparent 58%);
    transform:translateX(-70%); mix-blend-mode:overlay; }
  .cp-card.flipped .cp-shine i { animation:cp-shine-run 1.1s cubic-bezier(.3,.6,.4,1) .16s; }
  @keyframes cp-shine-run { to { transform:translateX(70%) } }

  /* Holo — epic and above only. A slow prismatic wash over the face, so the top
     of the ladder LOOKS like a different print run and not just a brighter one. */
  .cp-front.holo::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:7; opacity:.3;
    background:linear-gradient(122deg, rgba(255,80,160,0.5), rgba(80,200,255,0.5) 28%, rgba(140,255,190,0.5) 46%,
      rgba(255,215,110,0.5) 64%, rgba(190,120,255,0.5) 84%, rgba(255,80,160,0.5));
    background-size:260% 260%; mix-blend-mode:color-dodge; animation:cp-holo-wash 5.5s ease-in-out infinite; }
  @keyframes cp-holo-wash { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }

  /* Parallax. The card leans toward the pointer — one transform on a wrapper, so
     it composes with the flip rather than fighting it. Held to a small angle:
     this is a card in your hands, not a turntable. */
  .cp-tiltbox { perspective:1300px; transition:transform .34s cubic-bezier(.2,.85,.3,1); }
  .cp-tilt { transform-style:preserve-3d; transition:transform .22s ease-out; will-change:transform; }

  /* ── ZOOM ──────────────────────────────────────────────────────────────────
     Scale lives on the TILTBOX, never on .cp-tilt: the parallax handler writes
     .cp-tilt's transform outright on every pointermove, so a scale put there
     would be wiped on the next mouse twitch. Two elements, two jobs — the box
     is how close the card is, the inner wrap is which way it leans. */
  .cp-tiltbox.zoomed { transform:scale(var(--cp-zoom,1.75)); z-index:12; }
  .cp-stage.zoomed .cp-rank, .cp-stage.zoomed .cp-sub,
  .cp-stage.zoomed .cp-player-banner { opacity:0; transition:opacity .2s ease; }

  /* The glare. A specular hotspot that tracks the pointer across the face —
     the difference between a picture of a card and a laminated thing catching
     the light. Sits under .cp-shine's raking band so a flip still reads as a
     flip, and over the holo wash so the two multiply on an Epic. */
  .cp-front .cp-glare { position:absolute; inset:0; pointer-events:none; z-index:7; border-radius:12px;
    opacity:0; transition:opacity .25s ease; mix-blend-mode:soft-light;
    background:radial-gradient(circle 38% at var(--mx,50%) var(--my,50%),
      rgba(255,255,255,0.85), rgba(255,255,255,0.22) 42%, transparent 70%); }
  .cp-card.flipped .cp-front .cp-glare { opacity:.55; }
  /* Zoomed in, the whole print run gets louder: the hotspot tightens and the
     prismatic wash on a holo card speeds up. You leaned in, so it does too. */
  .cp-tiltbox.zoomed .cp-front .cp-glare { opacity:.8;
    background:radial-gradient(circle 26% at var(--mx,50%) var(--my,50%),
      rgba(255,255,255,0.95), rgba(255,255,255,0.3) 38%, transparent 66%); }
  .cp-tiltbox.zoomed .cp-front.holo::after { opacity:.46; animation-duration:2.4s; }

  /* The affordance. Cheap, permanent, and it names the key as well as the click
     so the zoom isn't a secret only mouse users are told about. */
  .cp-zoomhint { position:absolute; bottom:8px; left:50%; transform:translateX(-50%);
    font-size:0.5625rem; letter-spacing:1.5px; color:var(--text-dim); opacity:.75;
    white-space:nowrap; pointer-events:none; }

  @media (prefers-reduced-motion: reduce) {
    /* Zoom is a READING aid, so it stays — only the travel is removed. The glare
       is pure motion and goes entirely; the card is legible without it. */
    .cp-tiltbox { transition:none; }
    .cp-front .cp-glare { display:none; }
    .cp-tiltbox.zoomed .cp-front.holo::after { animation:none; }
  }

  /* Sparkle motes on a big pull. */
  .cp-mote { position:absolute; width:4px; height:4px; border-radius:50%; pointer-events:none; z-index:6;
    background:var(--cp-accent,#fff); box-shadow:0 0 10px var(--cp-accent,#fff);
    animation:cp-mote-rise var(--d,1.4s) ease-out forwards; }
  @keyframes cp-mote-rise { 0%{opacity:0; transform:translate(0,0) scale(.4)} 15%{opacity:1}
    100%{opacity:0; transform:translate(var(--tx),var(--ty)) scale(1.1)} }

  /* ── the shimmer ──────────────────────────────────────────────────────────
     The card's own lines, lit in reading order. cp-dim is where a part starts
     — present but recessive — and cp-lit is the pass of light going over it.
     Two states rather than an animation on everything means the eye is drawn to
     exactly one place at a time, which is the entire trick. */
  .cp-front .cp-dim { opacity:.34; filter:saturate(.5); transition:opacity .3s ease, filter .3s ease; }
  .cp-front .cp-lit { position:relative; opacity:1;
    animation:cp-lit-pulse .9s ease-out; }
  @keyframes cp-lit-pulse {
    0%   { text-shadow:none; transform:translateX(0) }
    18%  { text-shadow:0 0 14px var(--cp-accent,#fff), 0 0 30px var(--cp-accent,#fff); transform:translateX(2px) }
    100% { text-shadow:0 0 0 transparent; transform:translateX(0) }
  }
  /* The band of light itself, raked across whatever part is currently lit. */
  .cp-front .cp-lit::after { content:''; position:absolute; inset:-4px -10px; pointer-events:none;
    background:linear-gradient(96deg, transparent 40%, color-mix(in srgb, var(--cp-accent,#fff) 55%, transparent) 50%, transparent 60%);
    animation:cp-lit-sweep .9s ease-out; }
  @keyframes cp-lit-sweep { from{transform:translateX(-115%)} to{transform:translateX(115%)} }

  /* Corona — epic and up. A slow rotating fan BEHIND everything that outlives the
     burst, so a big pull keeps radiating for as long as it is on screen. */
  .cp-stage.corona::before { content:''; position:absolute; left:50%; top:46%; width:150vmax; height:150vmax;
    margin:-75vmax 0 0 -75vmax; pointer-events:none; z-index:-2; opacity:.22; mix-blend-mode:screen;
    background:conic-gradient(from 0deg, transparent 0deg, var(--cp-accent,#fff) 14deg, transparent 28deg,
      transparent 46deg, var(--cp-accent,#fff) 60deg, transparent 74deg, transparent 100deg,
      var(--cp-accent,#fff) 114deg, transparent 128deg, transparent 180deg,
      var(--cp-accent,#fff) 194deg, transparent 208deg, transparent 260deg,
      var(--cp-accent,#fff) 274deg, transparent 288deg, transparent 360deg);
    animation:cp-corona 22s linear infinite; }
  @keyframes cp-corona { to { transform:rotate(360deg) } }

  /* Dust — legendary and architect only. Falls past the card, never inside it. */
  .cp-dust { position:absolute; top:-8%; width:3px; height:3px; border-radius:50%; pointer-events:none; z-index:9;
    opacity:0; box-shadow:0 0 8px currentColor; animation:cp-dust-fall var(--d,3s) linear forwards; }
  @keyframes cp-dust-fall { 0%{opacity:0; transform:translate(0,0)} 12%{opacity:.9}
    100%{opacity:0; transform:translate(var(--dx,0),108vh)} }

  /* The wait. A visible bar for the fifteen seconds the card is yours, so moving
     on always reads as a choice you made or declined to make. */
  .cp-next { position:absolute; bottom:34px; left:50%; transform:translateX(-50%); white-space:nowrap;
    font-size:9px; letter-spacing:3px; color:#6d8296; opacity:0; transition:opacity .4s ease .5s; pointer-events:none; }
  .cp-next.on { opacity:1; }
  .cp-next i { display:block; height:2px; margin-top:6px; width:100%; border-radius:1px;
    background:color-mix(in srgb, var(--cp-accent,#fff) 70%, transparent); }

  /* ── progress pips + footer ───────────────────────────────────────────── */
  .cp-pips { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); display:flex; gap:7px; }
  .cp-pip { width:22px; height:3px; border-radius:2px; background:rgba(255,255,255,0.16); transition:background .3s, box-shadow .3s; }
  .cp-pip.done { background:var(--pipc,#8b98a8); box-shadow:0 0 8px var(--pipc,#8b98a8); }
  .cp-skip { position:absolute; top:16px; right:20px; font-size:10px; letter-spacing:2px; color:#5d6d7d;
    cursor:pointer; padding:6px 10px; border:1px solid rgba(255,255,255,0.12); border-radius:3px; }
  .cp-skip:hover { color:#c8d8e8; border-color:rgba(255,255,255,0.3); }

  /* ── the summary ──────────────────────────────────────────────────────── */
  .cp-summary { display:flex; flex-direction:column; align-items:center; gap:14px; width:100%; max-height:100%; }
  .cp-sum-head { font-size:13px; letter-spacing:5px; color:#c8d8e8; }
  .cp-sum-grid { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; overflow-y:auto; padding:4px; }
  /* Each card in the wall is a door back into that card, so it has to LOOK like
     one: it lifts under the pointer and says READ. A grid of tiles that can be
     clicked but never suggest it is a feature nobody finds. */
  .cp-sum-card { position:relative; width:118px; border-radius:7px; padding:8px; cursor:pointer;
    background:linear-gradient(170deg,#0c141c,#141d28);
    border:1px solid color-mix(in srgb, var(--c,#8b98a8) 60%, transparent);
    box-shadow:0 0 16px color-mix(in srgb, var(--c,#8b98a8) 22%, transparent);
    transition:transform .15s ease, box-shadow .2s ease, border-color .2s ease;
    animation:cp-sum-in .4s cubic-bezier(.2,1.4,.4,1) backwards; }
  @keyframes cp-sum-in { from{opacity:0; transform:translateY(14px) scale(.9)} to{opacity:1; transform:none} }
  .cp-sum-card:hover { transform:translateY(-4px) scale(1.04);
    border-color:color-mix(in srgb, var(--c,#8b98a8) 100%, transparent);
    box-shadow:0 8px 26px rgba(0,0,0,0.6), 0 0 26px color-mix(in srgb, var(--c,#8b98a8) 55%, transparent); }
  .cp-sum-read { margin-top:6px; font-size:7px; letter-spacing:2px; color:var(--c,#8b98a8); opacity:0; transition:opacity .16s; }
  .cp-sum-card:hover .cp-sum-read { opacity:1; }

  /* One card, read at full size out of the summary. */
  .cp-detail { display:flex; flex-direction:column; align-items:center; gap:16px; }
  .cp-sum-rank { font-size:8px; letter-spacing:2px; color:var(--c,#8b98a8); }
  .cp-sum-name { font-size:11px; color:#dfe9f2; margin-top:4px; word-break:break-word; }
  .cp-sum-type { font-size:9px; color:#63737f; margin-top:2px; }
  .cp-sum-dupe { font-size:8px; color:#c07b3a; margin-top:4px; letter-spacing:1px; }
  .cp-sum-note { font-size:11px; color:#8b98a8; }
  .cp-btns { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .cp-btn { font-family:inherit; font-size:11px; letter-spacing:2px; padding:9px 18px; cursor:pointer; border-radius:4px;
    background:linear-gradient(180deg,#16222e,#0c1219); color:#a9c4d8; border:1px solid rgba(120,190,240,0.35); }
  .cp-btn:hover { color:#eaf6ff; border-color:rgba(160,225,255,0.8); box-shadow:0 0 16px rgba(90,180,240,0.32); }
  .cp-btn.primary { color:#04121a; background:linear-gradient(180deg,#7fe8ff,#37a8d8); border-color:#9ff0ff; font-weight:700; }
  .cp-btn:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }

  /* ── the machine: a VENDING CABINET, not a terminal ───────────────────────
     Deliberately NOT the shared minigame CRT chassis. Every other device in the
     game is a screen you read; this one is a box you buy something out of, and
     the whole appeal of a card machine is watching the sleeve fall. So: painted
     steel, a lit marquee, product on real coils behind glass, a catch paddle, a
     belt, a chute and a flap that gets hit. No scanlines — there is no tube
     here, the glass is glass, and a scanline over a shelf of merchandise reads
     as a bug.

     THE GLASS IS THE WHOLE ILLUSION, so it is built the way real glass reads
     rather than as one sheen: an inner bevel where the pane meets the frame, a
     tinted body that darkens with depth, a broad raked specular, a second
     tighter highlight along the top edge, drifting room reflection, and dirt —
     smudges and dust that DON'T move with the product behind them. Parallax
     between the reflection layer and the shelves is what stops it looking like
     a picture of a machine. */
  #cardmach-overlay { position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 38%, rgba(12,19,28,0.74), rgba(2,4,7,0.93) 74%);
    backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);
    font-family:'Courier New', monospace; user-select:none; padding:16px; overflow:auto; }

  .vm-cab { position:relative; width:min(96vw,640px); border-radius:18px 18px 10px 10px; padding:0 0 14px;
    background:linear-gradient(100deg,#22323f 0%,#18242f 20%,#111b24 52%,#18242f 86%,#0a1017 100%);
    box-shadow:0 34px 90px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.10),
      inset 0 0 0 1px rgba(0,0,0,0.6), 0 0 60px rgba(90,190,240,0.16);
    border:1px solid #05070a; }
  /* Moulded seam down each flank — the cabinet is a pressing, not a rectangle. */
  .vm-cab::before, .vm-cab::after { content:''; position:absolute; top:64px; bottom:14px; width:3px; border-radius:2px;
    background:linear-gradient(180deg, rgba(255,255,255,0.07), rgba(0,0,0,0.5)); pointer-events:none; }
  .vm-cab::before { left:5px } .vm-cab::after { right:5px }
  .vm-cab.shake { animation:vm-shake .46s cubic-bezier(.36,.07,.19,.97); }
  @keyframes vm-shake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-4px,3px)}
    35%{transform:translate(4px,-3px)} 55%{transform:translate(-3px,1px)} 78%{transform:translate(2px,0)} }

  /* Lit marquee across the crown — the chaser bulbs are the machine's pulse. */
  .vm-marquee { position:relative; display:flex; align-items:center; gap:14px; padding:14px 16px 13px;
    border-radius:17px 17px 0 0; overflow:hidden;
    background:linear-gradient(180deg,#2a1140,#3c1055 46%,#1b0a2c);
    box-shadow:inset 0 -3px 8px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.12); }
  .vm-marquee::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(90deg, rgba(255,210,120,0.85) 0 4px, transparent 4px 22px);
    height:3px; top:auto; bottom:0; animation:vm-chase 1.1s linear infinite; opacity:.75; }
  @keyframes vm-chase { to { background-position:22px 0 } }
  .vm-logo { font-size:26px; color:#ffd27a; text-shadow:0 0 18px rgba(255,190,90,0.85); animation:vm-buzz 4s ease-in-out infinite; }
  @keyframes vm-buzz { 0%,88%,100%{opacity:1} 90%{opacity:.35} 92%{opacity:1} 94%{opacity:.5} }
  .vm-names { flex:1; line-height:1.2; }
  .vm-brand { font-size:20px; font-weight:700; letter-spacing:7px; color:#ffe9c0; text-shadow:0 0 12px rgba(255,180,70,0.65); }
  .vm-model { font-size:9px; letter-spacing:3px; color:rgba(255,220,180,0.6); margin-top:4px; }
  .vm-x { background:none; border:none; color:#d9b98a; font-family:inherit; font-size:16px; cursor:pointer;
    padding:0 2px; line-height:1; }
  .vm-x:hover { color:#ff6b6b; }

  .vm-body { display:flex; gap:14px; padding:16px 16px 10px; align-items:stretch; }

  /* The window assembly: pane + product + mechanism, all one coordinate space so
     the travelling sleeve can cross from a coil to the chute without changing
     parents mid-flight. */
  .vm-window { position:relative; flex:1; min-width:0; border-radius:8px; overflow:hidden;
    background:linear-gradient(180deg,#08121c,#040b12 58%,#02060a);
    box-shadow:inset 0 0 0 4px #0b131b, inset 0 0 0 5px rgba(150,220,255,0.13),
      inset 0 22px 40px rgba(0,0,0,0.8), 0 0 0 1px #05070a; }

  /* GLASS, layer by layer. All pointer-events:none and stacked above product. */
  .vm-pane { position:absolute; inset:0; pointer-events:none; z-index:8; border-radius:8px; }
  /* Body tint + depth: the pane is slightly cyan and gets darker toward the
     bottom, where the cabinet's own shadow falls behind it. */
  .vm-pane-tint { background:linear-gradient(184deg, rgba(150,225,255,0.055), rgba(10,30,45,0.10) 55%, rgba(0,0,0,0.30));
    box-shadow:inset 0 0 40px rgba(0,0,0,0.55); }
  /* The broad raked specular — the single strongest "there is a sheet in front
     of this" cue. It drifts, very slowly, so the pane never looks printed on. */
  .vm-pane-sheen { background:linear-gradient(108deg, transparent 0 26%, rgba(210,240,255,0.16) 33%,
      rgba(210,240,255,0.05) 39%, transparent 47%, transparent 66%, rgba(200,235,255,0.07) 71%, transparent 78%);
    animation:vm-sheen 13s ease-in-out infinite; }
  @keyframes vm-sheen { 0%,100%{transform:translateX(-3%)} 50%{transform:translateX(3%)} }
  /* Top-edge highlight + bottom-edge catch: where the pane's THICKNESS shows. */
  .vm-pane-edge { background:linear-gradient(180deg, rgba(255,255,255,0.24), transparent 2.5%),
      linear-gradient(0deg, rgba(160,220,255,0.10), transparent 3%); }
  /* Room reflection — soft blobs that drift independently of the shelves. The
     parallax is the point; a reflection locked to the product is a texture. */
  .vm-pane-refl { opacity:.5; mix-blend-mode:screen;
    background:radial-gradient(58% 30% at 22% 14%, rgba(190,225,255,0.18), transparent 70%),
      radial-gradient(40% 22% at 78% 30%, rgba(255,205,140,0.10), transparent 70%),
      radial-gradient(70% 24% at 50% 92%, rgba(140,200,255,0.08), transparent 70%);
    animation:vm-refl 17s ease-in-out infinite; }
  @keyframes vm-refl { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-7px,4px) scale(1.04)} }
  /* Dirt. Nobody cleans a card machine. Smudges are what make the pane an object
     with a history rather than a rendering trick. */
  .vm-pane-dirt { opacity:.5;
    background:radial-gradient(9px 13px at 24% 62%, rgba(230,245,255,0.09), transparent 70%),
      radial-gradient(7px 10px at 27% 66%, rgba(230,245,255,0.07), transparent 70%),
      radial-gradient(14px 9px at 71% 24%, rgba(230,245,255,0.05), transparent 70%),
      radial-gradient(3px 3px at 12% 32%, rgba(255,255,255,0.16), transparent 70%),
      radial-gradient(2px 2px at 84% 71%, rgba(255,255,255,0.13), transparent 70%),
      radial-gradient(2px 2px at 55% 12%, rgba(255,255,255,0.10), transparent 70%); }

  /* ── product: three shelves of three coils ───────────────────────────────── */
  .vm-shelves { position:relative; z-index:2; padding:12px 12px 6px; }
  .vm-shelf { display:flex; gap:10px; margin-bottom:12px; }
  .vm-slotwrap { flex:1; text-align:center; cursor:pointer; border-radius:5px; padding:3px 2px 4px;
    transition:background .16s, box-shadow .16s; }
  .vm-slotwrap:hover:not(.out) { background:rgba(120,200,255,0.07); }
  .vm-slotwrap.sel { background:rgba(120,200,255,0.13); box-shadow:0 0 0 1px rgba(140,220,255,0.6), 0 0 18px rgba(90,190,240,0.3); }
  .vm-slotwrap.out { cursor:not-allowed; }
  .vm-code { font-size:8px; letter-spacing:2px; color:#4c6274; margin-bottom:4px; }
  .vm-slotwrap.sel .vm-code { color:#9ff0ff; }
  /* The stack. A coil holds several sleeves and you can SEE how many are left —
     the back ones are just edges, the front one is the whole face. A slot two
     from empty has to look different from a full one or the counter is the only
     thing carrying the stock, and nobody reads a counter. */
  .vm-stack { position:relative; height:58px; }
  .vm-sleeve { position:absolute; left:0; right:0; bottom:0; height:46px; border-radius:3px; overflow:hidden;
    background:linear-gradient(150deg,#12212e,#2a5f7a 26%,#7fd8e8 42%,#123044 62%,#6b52a8 82%,#101a2a);
    box-shadow:0 3px 8px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.2); }
  .vm-sleeve.back { filter:brightness(.5); }
  .vm-sleeve.front::after { content:''; position:absolute; inset:-60%;
    background:linear-gradient(74deg, transparent 40%, rgba(255,255,255,0.62) 49%, transparent 58%);
    animation:cp-holo 3.2s linear infinite; mix-blend-mode:overlay; }
  .vm-sleeve i { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    font-style:normal; font-size:17px; color:#eaf6ff; text-shadow:0 1px 5px rgba(0,0,0,0.9); z-index:2; }
  .vm-sleeve.back i { display:none; }
  .vm-empty { position:absolute; inset:auto 0 0 0; height:46px; border-radius:3px;
    background:linear-gradient(180deg,#070d13,#0b1219); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05), inset 0 6px 12px rgba(0,0,0,0.8); }
  /* The coil the sleeve sits on. It turns when the machine vends. */
  .vm-coil { position:relative; height:11px; margin-top:3px; border-radius:0 0 3px 3px;
    background:repeating-linear-gradient(72deg, #7c8b99 0 2px, #303c47 2px 6px);
    box-shadow:inset 0 -2px 5px rgba(0,0,0,0.75); }
  .vm-slotwrap.turning .vm-coil { animation:vm-coil .28s linear 3; }
  @keyframes vm-coil { to { background-position:24px 0 } }
  .vm-tag { font-size:8px; letter-spacing:1px; color:#9fd8ff; margin-top:4px; }
  .vm-slotwrap.out .vm-tag { color:#54646f; }
  .vm-left { font-size:7px; letter-spacing:1px; color:#5d7d8d; }

  /* ── the mechanism: paddle, belt, chute ──────────────────────────────────── */
  .vm-mech { position:relative; z-index:3; height:52px; margin:2px 10px 10px; border-radius:4px;
    background:linear-gradient(180deg,#0a121a,#060c12);
    box-shadow:inset 0 2px 7px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.04); }
  /* The catch paddle: sprung steel that DIPS when something lands on it. */
  .vm-paddle { position:absolute; top:8px; height:7px; width:64px; border-radius:2px; transform-origin:50% 100%;
    background:linear-gradient(180deg,#8494a2,#3a4652);
    box-shadow:0 2px 5px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.3);
    transition:transform .12s cubic-bezier(.3,1.6,.5,1), left .34s cubic-bezier(.4,0,.3,1); }
  .vm-paddle.dip { transform:translateY(5px) rotate(-3deg); }
  /* The belt: a rubber run across the deck, ticking when it moves. */
  .vm-belt { position:absolute; left:8px; right:56px; top:26px; height:12px; border-radius:6px; overflow:hidden;
    background:linear-gradient(180deg,#1b232b,#0c1219); box-shadow:inset 0 2px 4px rgba(0,0,0,0.8); }
  .vm-belt::after { content:''; position:absolute; inset:0;
    background:repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 3px, transparent 3px 14px); }
  .vm-belt.run::after { animation:vm-beltrun .42s linear infinite; }
  @keyframes vm-beltrun { to { background-position:14px 0 } }
  /* The chute mouth at the end of the belt — where it leaves the window. */
  .vm-chute { position:absolute; right:8px; top:14px; width:40px; height:32px; border-radius:4px 4px 8px 8px;
    background:linear-gradient(180deg,#05090d,#0c141c); box-shadow:inset 0 4px 10px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(150,220,255,0.10); }
  .vm-chute::after { content:'▼'; position:absolute; left:0; right:0; bottom:3px; text-align:center;
    font-size:9px; color:#2c3b48; }
  .vm-chute.hot::after { color:#7fe8ff; text-shadow:0 0 8px rgba(127,232,255,0.8); }

  /* The travelling sleeve — ONE node for the whole journey, driven by the Web
     Animations API against MEASURED positions rather than a keyframe guess, so
     it genuinely leaves the coil you picked and genuinely reaches the chute at
     whatever size the cabinet happens to be. */
  .vm-drop { position:absolute; z-index:5; width:52px; height:46px; border-radius:3px; opacity:0; pointer-events:none;
    background:linear-gradient(150deg,#12212e,#2a5f7a 26%,#7fd8e8 42%,#123044 62%,#6b52a8 82%,#101a2a);
    box-shadow:0 8px 20px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.22); }

  /* Right-hand control column: price plate, odds board, balance, buttons. */
  .vm-side { width:168px; flex:none; display:flex; flex-direction:column; gap:9px; }
  .vm-plate { padding:9px 8px; border-radius:5px; text-align:center;
    background:linear-gradient(180deg,#0f1720,#080d13); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 5px rgba(0,0,0,0.7); }
  .vm-plate-lbl { font-size:8px; letter-spacing:2px; color:#5d7d8d; }
  .vm-plate-val { font-size:22px; color:#9ff0ff; text-shadow:0 0 14px rgba(90,220,255,0.6); }
  /* The selected coil, called out as its own readout — the machine confirming
     your choice back to you is most of what makes choosing feel like control. */
  .vm-pick { padding:7px 8px; border-radius:5px; text-align:center;
    background:linear-gradient(180deg,#101d26,#070f13); box-shadow:inset 0 0 0 1px rgba(120,200,255,0.22); }
  .vm-pick-val { font-size:18px; letter-spacing:4px; color:#ffd27a; text-shadow:0 0 12px rgba(255,190,90,0.6); }
  .vm-pick-sub { font-size:7px; letter-spacing:1px; color:#5d7d8d; margin-top:2px; }
  .vm-odds { display:flex; gap:4px; align-items:flex-end; height:44px; padding:0 2px; }
  .vm-odd { flex:1; text-align:center; }
  .vm-odd-bar { height:30px; display:flex; align-items:flex-end; justify-content:center; }
  .vm-odd-bar i { display:block; width:74%; border-radius:1px 1px 0 0; background:var(--c,#8b98a8);
    box-shadow:0 0 8px var(--c,#8b98a8); }
  .vm-odd-lbl { font-size:7px; letter-spacing:1px; color:#5d7d8d; margin-top:3px; }
  .vm-note { font-size:8px; letter-spacing:1px; color:#5d7d8d; text-align:center; }
  /* Physical pushbuttons — they travel when pressed. */
  .vm-btn { font-family:inherit; font-size:11px; letter-spacing:2px; padding:11px 6px; cursor:pointer; border-radius:5px;
    color:#a9c4d8; border:1px solid rgba(120,190,240,0.3);
    background:linear-gradient(180deg,#1a2937,#0c1219); box-shadow:0 3px 0 #05080c, inset 0 1px 0 rgba(255,255,255,0.08);
    transition:transform .06s, box-shadow .06s; }
  .vm-btn:hover:not(:disabled) { color:#eaf6ff; border-color:rgba(160,225,255,0.75); }
  .vm-btn:active:not(:disabled) { transform:translateY(3px); box-shadow:0 0 0 #05080c, inset 0 1px 0 rgba(255,255,255,0.08); }
  .vm-btn.primary { color:#04121a; background:linear-gradient(180deg,#7fe8ff,#37a8d8); border-color:#9ff0ff; font-weight:700;
    box-shadow:0 3px 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5); }
  .vm-btn.primary:active:not(:disabled) { box-shadow:0 0 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5); }
  .vm-btn:disabled { opacity:.38; cursor:not-allowed; }
  /* Just vended: the tear button breathes, so the offer is visible without a
     second modal landing on top of the machine you're still standing at. */
  .vm-fresh { animation:vm-fresh 1.5s ease-in-out infinite; }
  @keyframes vm-fresh { 0%,100%{ box-shadow:0 3px 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5); }
    50%{ box-shadow:0 3px 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5), 0 0 16px rgba(127,232,255,0.75); } }

  /* The delivery flap. It gets HIT — the kick is what sells the vend. */
  .vm-hatch { margin:0 16px; border-radius:6px; padding:6px;
    background:linear-gradient(180deg,#0e151c,#070b10); box-shadow:inset 0 2px 6px rgba(0,0,0,0.9); }
  .vm-flap { height:42px; border-radius:3px; display:flex; align-items:center; justify-content:center;
    font-size:9px; letter-spacing:3px; color:#4a5a68; transform-origin:50% 0%;
    background:linear-gradient(180deg,#131c25,#080e14 70%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -8px 14px rgba(0,0,0,0.85); }
  .vm-flap.kick { animation:vm-kick .55s ease-out; }
  @keyframes vm-kick { 0%{transform:rotateX(0)} 26%{transform:rotateX(58deg)} 58%{transform:rotateX(-10deg)} 100%{transform:rotateX(0)} }
  .vm-tray { margin:10px 16px 0; height:30px; border-radius:3px; display:flex; align-items:center; justify-content:center;
    font-size:9px; letter-spacing:3px; color:#3d4d5d;
    background:linear-gradient(180deg,#05080c,#0d141b); box-shadow:inset 0 3px 9px rgba(0,0,0,0.9); }
  .vm-tray.loaded { color:#7fe8ff; text-shadow:0 0 10px rgba(127,232,255,0.7); animation:cp-blink 1.6s ease-in-out infinite; }
  .vm-dead { position:relative; z-index:2; color:#5d6d7d; text-align:center; padding:96px 10px; letter-spacing:2px; font-size:12px; line-height:1.8; }
  .vm-hint { padding:0 16px; font-size:8px; letter-spacing:1px; color:#4c6274; text-align:center; }

  @media (max-width: 560px) {
    .vm-body { flex-direction:column; }
    .vm-side { width:auto; }
    .vm-odds { height:38px; }
  }

  @media (prefers-reduced-motion: reduce) {
    #cardpack-overlay *, #cardmach-overlay * { animation-duration:.01ms !important; animation-iteration-count:1 !important;
      transition-duration:.01ms !important; }
  }
  `;
  document.head.appendChild(s);
}

// ── the machine ───────────────────────────────────────────────────────────────
// THE BRAND. Not the Mint, and never the word "mint": minting is what a player
// does to themselves at a terminal, and a machine that borrowed the word would
// be advertising a service it doesn't sell.
//
// ARCHITECT DRAFT works three ways at once, which is why it beat the alternatives:
// an architect DRAFTS, a collector DRAFTS a set, and being drafted is what
// happens to everybody whose face ends up in that pool without being asked.
// "COLLECTED WORKS" is the same joke one floor down — an architect's collected
// works is their portfolio, and yours is a shoebox of strangers.
const VM_BRAND = 'ARCHITECT DRAFT';
const VM_TAGLINE = 'COLLECTED WORKS · SERIES 1';

// The cabinet now carries the brand in its own name, so the marquee's model line
// must not say it twice — "ARCHITECT DRAFT · ARCHITECT DRAFT CARD MACHINE" reads
// like a bug, because it is one. Strip the brand off the front and keep whatever
// the fixture actually calls itself.
function vmModel(name) {
  const s = String(name || 'card dispenser').trim();
  const bare = s.replace(new RegExp(`^${VM_BRAND}\\s*`, 'i'), '').trim();
  return bare || s;
}

let machine = null;   // { overlay, close, data, pick, busy, justVended }

// Three shelves of three. Codes are the SERVER's — the panel never invents a
// coil, because the coil you press has to be the coil the verb charges you for.
const SHELVES = [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']];
const slotOf = (d, code) => (d.slots || []).find(s => s.code === code) || { code, left: 0, cap: 8 };
const stockedCodes = (d) => (d.slots || []).filter(s => s.left > 0).map(s => s.code);
const reduceMotion = () => prefersReducedMotion();

export function openCardMachinePanel(msg) {
  ensurePackStyles();
  if (machine) machine.close();

  const mounted = mountOverlay({
    id: 'cardmach-overlay',
    html: `<div class="vm-cab" id="vm-cab">
      <div class="vm-marquee">
        <span class="vm-logo">◈</span>
        <div class="vm-names">
          <div class="vm-brand">${VM_BRAND}</div>
          <div class="vm-model">${esc(vmModel(msg.machine)).toUpperCase()} · ${VM_TAGLINE}</div>
        </div>
        <button class="vm-x" aria-label="Close">&#10005;</button>
      </div>
      <div class="vm-body">
        <div class="vm-window" id="vm-window">
          <div class="vm-shelves" id="vm-shelves"></div>
          <div class="vm-mech" id="vm-mech">
            <div class="vm-belt" id="vm-belt"></div>
            <div class="vm-paddle" id="vm-paddle"></div>
            <div class="vm-chute" id="vm-chute"></div>
          </div>
          <div class="vm-drop" id="vm-drop"></div>
          <div class="vm-pane vm-pane-tint"></div>
          <div class="vm-pane vm-pane-refl"></div>
          <div class="vm-pane vm-pane-sheen"></div>
          <div class="vm-pane vm-pane-dirt"></div>
          <div class="vm-pane vm-pane-edge"></div>
        </div>
        <div class="vm-side" id="vm-side"></div>
      </div>
      <div class="vm-hatch"><div class="vm-flap" id="vm-flap">PUSH</div></div>
      <div class="vm-tray" id="vm-tray">EMPTY TRAY</div>
      <div class="vm-hint">Every sleeve on these coils is already what it is. About one in twelve runs HOT — triple
        weight on epic and legendary — and nothing on the outside of a sleeve will ever tell you which.</div>
    </div>`,
    onClose: () => { machine = null; },
  });
  // The default pick is the fullest coil, so BUY works the instant the panel
  // opens: choosing is an option, never a toll.
  const slots = msg.slots || [];
  const best = [...slots].filter(s => s.left > 0).sort((a, b) => b.left - a.left || a.code.localeCompare(b.code))[0];
  machine = { ...mounted, data: msg, pick: best?.code || null, busy: false };

  mounted.overlay.querySelector('.vm-x').addEventListener('click', () => { sfx('cards-ui'); mounted.close(); });
  renderMachine();

  // Delegated, because both columns are re-rendered on every patch and their
  // controls are new nodes each time. Nothing here transacts — the buttons send
  // the ordinary verbs and the server re-checks power, price, stock and balance
  // exactly as it would for a typed command.
  mounted.overlay.addEventListener('click', (e) => {
    const slotEl = e.target.closest('.vm-slotwrap');
    if (slotEl) {
      const code = slotEl.dataset.code;
      if (slotOf(machine.data, code).left < 1) { sfx('cards-deny'); return; }
      machine.pick = code;
      sfx('cards-ui');
      renderMachine();
      return;
    }
    const btn = e.target.closest('#vm-buy, #vm-open');
    if (!btn) return;
    if (btn.disabled) { sfx('cards-deny'); return; }
    sfx('cards-ui');
    if (btn.id === 'vm-open') { machine.justVended = false; mounted.close(); sendCmdSilent('openpack'); return; }
    // The coil travels with the verb. A typed `buypack confirm` with no code is
    // still valid — the server falls back to the fullest coil — so the panel and
    // the keyboard reach the same machine.
    sendCmdSilent(`buypack confirm${machine.pick ? ' ' + machine.pick : ''}`);
  });
  sfx('cards-slide');
}

// Live patch after a vend — the panel stays open so you can buy a second sleeve
// without walking away and back.
export function updateCardMachine(patch) {
  if (!machine) return;
  Object.assign(machine.data, patch);
  // A coil the patch just emptied can't stay selected, or BUY would aim at a
  // bare column and the server would (correctly) refuse a click the panel had
  // shown as live.
  if (machine.pick && slotOf(machine.data, machine.pick).left < 1) {
    const left = stockedCodes(machine.data);
    machine.pick = left.length ? left[0] : null;
  }
  renderMachine();
}

export function closeCardMachine() { machine?.close(); }
export function isCardMachineOpen() { return !!machine; }

function renderMachine() {
  if (!machine) return;
  const d = machine.data;
  const shelves = machine.overlay.querySelector('#vm-shelves');
  const side = machine.overlay.querySelector('#vm-side');
  const mech = machine.overlay.querySelector('#vm-mech');
  const total = d.pool?.total || 0;
  const stocked = stockedCodes(d).length;

  if (!total) {
    shelves.innerHTML = `<div class="vm-dead">— NO STOCK —<br><br>Nobody has minted anything yet.<br>Every coil behind the glass is bare.</div>`;
    if (mech) mech.style.visibility = 'hidden';
  } else {
    if (mech) mech.style.visibility = '';
    shelves.innerHTML = SHELVES.map(row =>
      `<div class="vm-shelf">` + row.map(code => {
        const s = slotOf(d, code);
        const out = s.left < 1;
        const sel = machine.pick === code;
        // Up to three visible edges behind the face — past that the stack reads
        // as "plenty" and counting them stops being information.
        const backs = Math.min(3, Math.max(0, s.left - 1));
        const stack = out
          ? `<div class="vm-empty"></div>`
          : Array.from({ length: backs }, (_, i) =>
              `<div class="vm-sleeve back" style="bottom:${(backs - i) * 4}px; transform:scale(${1 - (backs - i) * 0.03})"></div>`).join('')
            + `<div class="vm-sleeve front"><i>◈</i></div>`;
        return `<div class="vm-slotwrap${out ? ' out' : ''}${sel ? ' sel' : ''}" data-code="${code}"` +
          ` title="${out ? `Coil ${code} is empty` : `Take a sleeve from coil ${code}`}">` +
          `<div class="vm-code">${code}</div>` +
          `<div class="vm-stack">${stack}</div><div class="vm-coil"></div>` +
          `<div class="vm-tag">${out ? 'OUT' : '₵' + d.price}</div>` +
          `<div class="vm-left">${out ? '&nbsp;' : `${s.left} LEFT`}</div></div>`;
      }).join('') + `</div>`).join('');
  }

  const by = d.pool?.byRank || {};
  const ranks = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  // The odds board is drawn from the LIVE pool, so a rank nobody has minted
  // shows as a flat nub rather than an advertised chance that cannot pay out.
  const max = Math.max(1, ...ranks.map(r => by[r] || 0));
  const packs = d.packs || 0;
  const canBuy = total > 0 && stocked > 0 && (d.credits ?? 0) >= d.price && !!machine.pick;
  const fresh = !!machine.justVended && packs > 0;
  side.innerHTML =
    `<div class="vm-plate"><div class="vm-plate-lbl">YOUR CREDIT</div>` +
      `<div class="vm-plate-val">₵${(d.credits ?? 0).toLocaleString()}</div></div>` +
    `<div class="vm-pick"><div class="vm-plate-lbl">SELECTED COIL</div>` +
      `<div class="vm-pick-val">${machine.pick || '——'}</div>` +
      `<div class="vm-pick-sub">${machine.pick ? `${slotOf(d, machine.pick).left} SLEEVE${slotOf(d, machine.pick).left === 1 ? '' : 'S'} ON THE COIL` : 'NOTHING LOADED'}</div></div>` +
    `<div class="vm-note">IN THE POOL — ${total}</div>` +
    `<div class="vm-odds">` + ranks.map(r => {
      const n = by[r] || 0;
      const h = n ? Math.max(3, Math.round((n / max) * 30)) : 2;
      return `<div class="vm-odd" style="--c:${rarity(r).color}">` +
        `<div class="vm-odd-bar"><i style="height:${h}px"></i></div>` +
        `<div class="vm-odd-lbl">${rarity(r).label.slice(0, 4)}</div></div>`;
    }).join('') + `</div>` +
    `<div class="vm-note">BUY-BACK ₵${d.scrapValue} A DUPE</div>` +
    // A sleeve just hit the tray, so TEAR takes the primary button and BUY steps
    // down to it. The offer has to be made at the moment the machine finishes
    // delivering — that is when a player wants it — and it stays an OFFER: the
    // panel doesn't open anything, doesn't close itself, and buying a second
    // sleeve instead is one click away in the same place it always was.
    `<button class="vm-btn${fresh ? '' : ' primary'}" id="vm-buy"${canBuy ? '' : ' disabled'}>` +
      `${machine.pick ? `BUY ${machine.pick} · ₵${d.price}` : 'SELECT A COIL'}</button>` +
    `<button class="vm-btn${fresh ? ' primary vm-fresh' : ''}" id="vm-open"${packs < 1 ? ' disabled' : ''}>` +
      `${fresh ? 'TEAR IT OPEN' : 'TEAR ONE OPEN'}</button>`;

  const tray = machine.overlay.querySelector('#vm-tray');
  tray.classList.toggle('loaded', packs > 0);
  tray.textContent = packs ? `${packs} UNOPENED SLEEVE${packs === 1 ? '' : 'S'} ON YOU` : 'EMPTY TRAY';
}

// The vend response: run the hardware, patch the panel, and let the log line
// through. The offer to open it NOW is the tray lighting up — you are already
// standing at the machine, so a second modal on top would be noise.
//
// The animation is a REPORT, never a promise: it only runs on the server's vend
// message, so a refused buy (no power, no credit, bare coil) shows nothing
// moving. Patch AFTER the journey starts, so the coil the sleeve leaves is the
// one you were looking at rather than one already redrawn a sleeve lighter.
export function cardMachineVend(msg) {
  sfx('cards-vend');
  if (machine) {
    // Latched when the sleeve LANDS, not when the buy was sent, so the offer
    // arrives with the object rather than ahead of it.
    playVend(msg.slot, () => {
      if (machine) machine.justVended = true;
      updateCardMachine({ credits: msg.credits, packs: msg.packs, slots: msg.slots });
    });
  }
  refreshInventory();
}

// ── the delivery ──────────────────────────────────────────────────────────────
// Four stages, four sounds, one node: the coil turns and the sleeve TIPS off it,
// it falls and is CAUGHT by the sprung paddle, the belt CARRIES it across the
// deck, and the chute DROPS it through into a flap that bangs. Every position is
// measured off the live layout rather than baked into a keyframe, so this works
// at any cabinet size and always starts at the coil the player actually chose.
//
// Purely cosmetic. The sleeve was in the player's inventory before the first
// frame drew, and `onSettled` patching the panel late is presentation, not state.
function playVend(code, onSettled) {
  const ov = machine?.overlay;
  if (!ov) { onSettled?.(); return; }
  const drop = ov.querySelector('#vm-drop');
  const win = ov.querySelector('#vm-window');
  const paddle = ov.querySelector('#vm-paddle');
  const belt = ov.querySelector('#vm-belt');
  const chute = ov.querySelector('#vm-chute');
  const flap = ov.querySelector('#vm-flap');
  const cab = ov.querySelector('#vm-cab');
  const slot = ov.querySelector(`.vm-slotwrap[data-code="${code}"]`) || ov.querySelector('.vm-slotwrap');
  const face = slot?.querySelector('.vm-sleeve.front') || slot?.querySelector('.vm-sleeve');
  if (!drop || !win || !face || !paddle || !chute) { onSettled?.(); return; }

  // Reduced motion: the machine still reports, it just doesn't perform.
  if (reduceMotion()) { sfx('cards-chute'); onSettled?.(); return; }
  if (machine.busy) { onSettled?.(); return; }
  machine.busy = true;

  const rel = (el) => {
    const w = win.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height };
  };
  const from = rel(face);
  const pad = rel(paddle);
  const mouth = rel(chute);

  drop.style.left = `${from.x}px`;
  drop.style.top = `${from.y}px`;
  drop.style.width = `${from.w}px`;
  drop.style.height = `${from.h}px`;
  drop.style.opacity = '0';

  // Park the paddle under the coil that's about to give, so it is CAUGHT rather
  // than landing on a paddle that happened to be somewhere else.
  paddle.style.left = `${Math.max(4, from.x + from.w / 2 - pad.w / 2)}px`;

  // Stage 1 — the coil turns.
  slot.classList.remove('turning');
  void slot.offsetWidth;
  slot.classList.add('turning');
  sfx('cards-coil');

  const catchY = pad.y - from.h + 2;
  const catchX = from.x;

  // Stage 2 — it tips off the coil and falls onto the paddle.
  const anim = (kf, opts) => drop.animate(kf, { fill: 'forwards', ...opts });
  setTimeout(() => {
    if (!machine) return;
    anim([
      { transform: `translate(0,0) rotate(0deg)`, opacity: 1, offset: 0 },
      { transform: `translate(4px,${(catchY - from.y) * 0.35}px) rotate(14deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(0px,${catchY - from.y}px) rotate(3deg)`, opacity: 1, offset: 1 },
    ], { duration: 480, easing: 'cubic-bezier(.5,0,.75,1)' });

    setTimeout(() => {
      if (!machine) return;
      sfx('cards-catch');
      paddle.classList.add('dip');
      setTimeout(() => paddle.classList.remove('dip'), 190);

      // Stage 3 — the belt carries it to the chute mouth.
      belt?.classList.add('run');
      sfx('cards-belt');
      const rideY = pad.y - from.h + 6;
      const rideX = mouth.x + mouth.w / 2 - from.w / 2 - catchX;
      anim([
        { transform: `translate(0px,${catchY - from.y}px) rotate(3deg)`, offset: 0 },
        { transform: `translate(${rideX * 0.5}px,${rideY - from.y}px) rotate(-2deg)`, offset: 0.55 },
        { transform: `translate(${rideX}px,${rideY - from.y}px) rotate(0deg)`, offset: 1 },
      ], { duration: 760, easing: 'cubic-bezier(.35,0,.4,1)' });

      setTimeout(() => {
        if (!machine) return;
        belt?.classList.remove('run');
        chute?.classList.add('hot');
        sfx('cards-chute');

        // Stage 4 — through the chute, and the flap takes the hit.
        anim([
          { transform: `translate(${rideX}px,${rideY - from.y}px) rotate(0deg)`, opacity: 1, offset: 0 },
          { transform: `translate(${rideX}px,${rideY - from.y + 30}px) rotate(11deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${rideX}px,${rideY - from.y + 70}px) rotate(20deg)`, opacity: 0, offset: 1 },
        ], { duration: 340, easing: 'cubic-bezier(.5,0,.9,1)' });

        setTimeout(() => {
          flap?.classList.remove('kick');
          void flap?.offsetWidth;
          flap?.classList.add('kick');
          cab?.classList.remove('shake');
          void cab?.offsetWidth;
          cab?.classList.add('shake');
          setTimeout(() => chute?.classList.remove('hot'), 700);
          if (machine) machine.busy = false;
          drop.style.opacity = '0';
          onSettled?.();
        }, 250);
      }, 780);
    }, 500);
  }, 420);
}

// ── the reveal ────────────────────────────────────────────────────────────────
let show = null;

export function isPackRevealOpen() { return !!show; }

export function openPackReveal(msg) {
  ensurePackStyles();
  if (show) show.close();
  const cards = Array.isArray(msg.cards) ? msg.cards : [];
  if (!cards.length) return;
  closeCardMachine();

  const mounted = mountOverlay({
    id: 'cardpack-overlay',
    closeOnBackdrop: false,     // a stray click mid-reveal must not eat the show
    // Space and Enter mirror the click; Escape closes, via mountOverlay itself.
    // Z zooms, and Escape is CAUGHT while zoomed so the first press backs out of
    // the zoom rather than closing the whole pack — the usual layered-Escape
    // contract, and the alternative loses you a card you were reading.
    onKey: (e) => {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); toggleZoom(); return; }
      if (e.key === 'Escape' && isZoomed()) { e.preventDefault(); e.stopPropagation(); setZoom(false); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // Space/Enter is the "move on" key. While zoomed it un-zooms first, so it
        // never skips a card you had deliberately leaned into.
        if (isZoomed()) { setZoom(false); return; }
        advance();
      }
    },
    html: `<div class="cp-stage" id="cp-stage">
        <div class="cp-ambient" id="cp-ambient"></div>
        <div class="cp-flash" id="cp-flash"></div>
        <div id="cp-slot"></div>
        <div class="cp-next" id="cp-next">CLICK FOR THE NEXT CARD<i></i></div>
        <div class="cp-pips" id="cp-pips"></div>
      </div>
      <div class="cp-skip" id="cp-skip">SKIP ▸</div>`,
    onClose: () => { clearTimers(); show = null; },
  });

  show = {
    ...mounted, cards, idx: -1, phase: 'sealed', timers: [],
    scrapped: msg.scrapped || 0, scrapValue: msg.scrapValue || 0, packs: msg.packs || 0,
    coil: msg.coil || null, machine: msg.machine || null, hot: !!msg.hot,
  };

  mounted.overlay.querySelector('#cp-skip').addEventListener('click', (e) => { e.stopPropagation(); sfx('cards-ui'); toSummary(); });
  // Anywhere on the stage advances — EXCEPT the card itself, which zooms.
  //
  // This is the one place the old "one affordance, always the same one" rule
  // bends, and it bends the right way round: the thing you click to move ON is
  // everything that is not the card, and the card is the one object on screen
  // you might want to keep. A misclick therefore costs you a zoom, never the
  // card you were reading. While zoomed, a stage click zooms back out rather
  // than advancing, so it takes two deliberate acts to leave a card behind.
  mounted.overlay.addEventListener('click', (e) => {
    if (e.target.closest('.cp-card')) { toggleZoom(); return; }
    if (isZoomed()) { setZoom(false); return; }
    advance();
  });

  // Parallax. The card leans toward the pointer, which costs one transform and
  // buys the single strongest "this is an object in front of me" cue available
  // to a flat page. Deliberately small, and deliberately re-queried each move
  // rather than cached — the wrapper is replaced on every card.
  mounted.overlay.addEventListener('pointermove', (e) => {
    const wrap = mounted.overlay.querySelector('#cp-wrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    wrap.style.transform = `rotateY(${clamp(dx) * 9}deg) rotateX(${clamp(-dy) * 7}deg)`;
    // Same pointer, second job: park the specular hotspot under the cursor. In
    // PERCENT of the card, not pixels, so it survives the zoom scale for free —
    // 50%/50% is the middle of the card whether it is small or large.
    const front = wrap.querySelector('.cp-front');
    if (front) {
      front.style.setProperty('--mx', `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))}%`);
      front.style.setProperty('--my', `${Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))}%`);
    }
  });
  renderPips();
  renderSealed();
  refreshInventory();
}

function clearTimers() {
  if (!show) return;
  show.timers.forEach(clearTimeout);
  show.timers = [];
  clearTimeout(show.advTimer);
  show.advTimer = null;
}
function later(fn, ms) { if (show) show.timers.push(setTimeout(fn, ms)); }

function advance() {
  if (!show) return;
  if (show.phase === 'sealed') { tear(); return; }
  if (show.phase === 'revealing') { clearTimers(); nextCard(); return; }
  if (show.phase === 'dealt') { clearTimers(); nextCard(); return; }
}

// ── zoom ──────────────────────────────────────────────────────────────────────
// Lean in on a card. The reveal is a cinematic, but the card is a DOCUMENT — it
// carries a stat block, a quote and a condition line the reveal renders at the
// size a whole pack has to fit into. Zoom is how you actually read the thing you
// just pulled, which is why it also stops the clock: inspecting a card must never
// be a race against the auto-advance that exists to stop the pack stalling.
function isZoomed() { return !!show?.overlay.querySelector('.cp-tiltbox.zoomed'); }

function toggleZoom() { setZoom(!isZoomed()); }

function setZoom(on) {
  if (!show) return;
  const box = show.overlay.querySelector('.cp-tiltbox');
  if (!box) return;
  // A sealed pack has nothing to read yet, and an unflipped card is a back.
  if (on && !show.overlay.querySelector('.cp-card.flipped')) return;
  if (on === box.classList.contains('zoomed')) return;

  box.classList.toggle('zoomed', on);
  show.overlay.querySelector('.cp-stage')?.classList.toggle('zoomed', on);
  sfx(on ? 'cards-slide' : 'cards-ui');

  if (on) {
    holdAdvance();
    // Replay the line walk at reading size. The shimmer was built to WALK the eye
    // through a card; up close is exactly when that is worth having, and it costs
    // one call because the pass selects on the server-rendered classes.
    const R = rarity(show.cards[show.idx]?.rarity);
    shimmerFace(show.overlay.querySelector('#cp-slot'), R);
  } else {
    resumeAdvance();
  }
}

// Freeze the countdown where it stands — bar included, or the visible timer and
// the real one disagree and the bar stops being the honest thing it was built as.
function holdAdvance() {
  if (!show) return;
  clearTimeout(show.advTimer);
  show.advTimer = null;
  show.advLeft = Math.max(0, (show.advAt || 0) - Date.now());
  const bar = show.overlay.querySelector('#cp-next i');
  if (bar) { const w = bar.getBoundingClientRect().width; bar.style.transition = 'none'; bar.style.width = `${w}px`; }
}

// Give back what was left, with a floor: coming out of a zoom onto 200ms of
// remaining bar would yank the card away the instant you stopped looking at it.
function resumeAdvance() {
  if (!show || show.phase === 'done') return;
  armAdvance(Math.max(3000, show.advLeft ?? AUTO_MS));
}

function renderPips() {
  const pips = show.overlay.querySelector('#cp-pips');
  pips.innerHTML = show.cards.map(() => `<span class="cp-pip"></span>`).join('');
}

// The sealed sleeve looks ORDINARY even when it is hot. That is deliberate: the
// gold is under the foil, so a hot run is something you find out you got, never
// something you could have read off the machine or the pack in your hand.
function renderSealed() {
  const slot = show.overlay.querySelector('#cp-slot');
  slot.innerHTML = `<div class="cp-pack" id="cp-pack">
      <div class="cp-pack-body"></div>
      <div class="cp-pack-top"></div>
      <div class="cp-pack-seam"></div>
      <div class="cp-pack-print">
        <div class="cp-pack-mark">◈</div>
        <div class="cp-pack-brand">${VM_BRAND}</div>
        <div class="cp-pack-sub">SERIES 1 · SEALED</div>
        <div class="cp-pack-count">${show.coil ? `COIL ${esc(show.coil)}` : 'FOIL SLEEVE'}</div>
      </div>
      ${show.machine ? `<div class="cp-pack-from">${esc(show.machine)}</div>` : ''}
      <div class="cp-pack-hint">CLICK TO TEAR</div>
    </div>`;
}

function tear() {
  if (!show || show.phase !== 'sealed') return;
  show.phase = 'tearing';
  const pack = show.overlay.querySelector('#cp-pack');
  const hint = show.overlay.querySelector('.cp-pack-hint');
  if (hint) hint.remove();
  pack.classList.add('tearing');
  sfx('cards-tear');
  // The seam lights as it runs, so the rip is something you WATCH travel rather
  // than a state the pack is suddenly in.
  show.overlay.querySelector('#cp-stage')?.classList.add('tearlight');
  later(() => {
    pack.classList.add('torn');
    throwFlecks(pack, show.hot);
    // The pack gives up its contents: a burst ring out of the seam, a hard flash,
    // and the stage kicks. Three cheap layers that turn "the pack disappeared"
    // into "the pack was opened".
    const stage = show.overlay.querySelector('#cp-stage');
    stage.style.setProperty('--cp-accent', show.hot ? '#ffc23d' : '#7fe8ff');
    stage.style.setProperty('--cp-flash', show.hot ? '0.42' : '0.2');
    stage.style.setProperty('--cp-shake', show.hot ? '1' : '0.45');
    const burst = document.createElement('div');
    burst.className = 'cp-ring on';
    stage.appendChild(burst);
    later(() => burst.remove(), 900);
    const flash = show.overlay.querySelector('#cp-flash');
    flash?.classList.add('on');
    later(() => flash?.classList.remove('on'), 520);
    stage.classList.add('shake');
    later(() => stage.classList.remove('shake'), 460);
    later(() => stage.classList.remove('tearlight'), 400);
    // A hot run announces itself HERE — between the tear and the first card,
    // where it retunes your expectation of everything about to be dealt. After
    // the cards it would be a footnote; before them it is the whole moment.
    if (show.hot) {
      sfx('cards-hot');
      const stage = show.overlay.querySelector('#cp-stage');
      stage.style.setProperty('--cp-accent', '#ffc23d');
      const b = document.createElement('div');
      b.className = 'cp-hot-banner';
      b.innerHTML = `<span>HOT RUN</span><i>TRIPLE EPIC &amp; LEGENDARY</i>`;
      stage.appendChild(b);
      later(() => b.remove(), 2600);
      const amb = show.overlay.querySelector('#cp-ambient');
      if (amb) { amb.style.opacity = '0.3'; later(() => { amb.style.opacity = '0.12'; }, 900); }
    }
  }, 320);
  // The hot banner needs room to land before the first card starts dealing.
  later(() => { show.phase = 'revealing'; nextCard(); }, show.hot ? 2000 : 1000);
}

// Foil comes off in bits. Positions and vectors are random per tear so two
// openings never look identical — the cards are the only thing that repeats.
function throwFlecks(host, gold = false) {
  for (let i = 0; i < (gold ? 34 : 16); i++) {
    const f = document.createElement('span');
    f.className = `cp-fleck${gold ? ' gold' : ''}`;
    f.style.left = `${18 + Math.random() * 64}%`;
    f.style.top = `${4 + Math.random() * 22}%`;
    f.style.setProperty('--tx', `${(Math.random() - 0.5) * 340}px`);
    f.style.setProperty('--ty', `${-90 - Math.random() * 230}px`);
    f.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    f.style.setProperty('--d', `${0.7 + Math.random() * 0.7}s`);
    host.appendChild(f);
  }
}

function nextCard() {
  if (!show) return;
  show.idx++;
  if (show.idx >= show.cards.length) { toSummary(); return; }

  const card = show.cards[show.idx];
  const R = rarity(card.rarity);
  const stage = show.overlay.querySelector('#cp-stage');
  const slot = show.overlay.querySelector('#cp-slot');
  const ambient = show.overlay.querySelector('#cp-ambient');
  show.phase = 'dealt';

  // The previous card's lingering effects come off before this one's go on, or a
  // Common inherits a Legendary's corona and the ladder stops meaning anything.
  stage.classList.remove('corona');
  stage.querySelectorAll('.cp-dust').forEach(d => d.remove());
  show.overlay.querySelector('#cp-next')?.classList.remove('on');

  stage.style.setProperty('--cp-accent', R.color);
  stage.style.setProperty('--cp-glow', String(R.glow));
  stage.style.setProperty('--cp-flash', String(R.flash));
  stage.style.setProperty('--cp-shake', String(R.shake));

  // Epic and above print holographic. It is a property of the CARD, so it is
  // decided off the same rarity row everything else reads and never set by hand.
  const holo = (R.rays || 0) >= 16;
  slot.innerHTML = `<div class="cp-tiltbox"><div class="cp-card-wrap cp-tilt" id="cp-wrap">
      <div class="cp-rays" id="cp-rays">${Array.from({ length: R.rays }, (_, i) =>
        `<span class="cp-ray" style="transform:rotate(${(360 / Math.max(1, R.rays)) * i}deg) translateX(-50%)"></span>`).join('')}</div>
      <div class="cp-ring" id="cp-ring"></div>
      <div class="cp-card" id="cp-card">
        <div class="cp-card-side cp-back"><span class="cp-back-mark">◈</span></div>
        <div class="cp-card-side cp-front${holo ? ' holo' : ''}">${card.face || `<span class="card-face">${esc(card.name)}</span>`}
          <span class="cp-glare"></span><span class="cp-shine"><i></i></span></div>
      </div>
      ${card.subject_type === 'player' ? `<div class="cp-player-banner">PLAYER CARD</div>` : ''}
      <div class="cp-rank">${R.label}</div>
      <div class="cp-sub">${esc(card.name)} · ${esc(card.subject_type)}${card.dupe ? ` · <span class="cp-dupe-tag">DUPLICATE, ₵${show.scrapValue}</span>` : ''}</div>
      <div class="cp-zoomhint">CLICK THE CARD TO ZOOM · Z</div>
    </div></div>`;

  const el = slot.querySelector('#cp-card');
  sfx('cards-slide');
  requestAnimationFrame(() => el.classList.add('in'));

  // The hold. A Common barely has one; a Legendary sits on the riser for the
  // better part of half a second before it turns.
  later(() => {
    if (!show) return;
    show.phase = 'revealing';
    el.classList.add('flipped');
    sfx(R.sfx);
    if (card.dupe) later(() => sfx('cards-dupe'), 340);
    if (card.subject_type === 'player') later(() => sfx('cards-player-sting'), 120);

    slot.querySelector('#cp-ring')?.classList.add('on');
    ambient.style.opacity = String(0.06 + R.glow * 0.2);
    show.overlay.querySelector('#cp-flash').classList.add('on');
    later(() => show?.overlay.querySelector('#cp-flash')?.classList.remove('on'), 520);

    if (isBig(card.rarity)) {
      slot.querySelector('#cp-rays')?.classList.add('on');
      if (R.shake) { stage.classList.add('shake'); later(() => stage.classList.remove('shake'), 460); }
      throwMotes(slot.querySelector('.cp-card-wrap'), Math.round(R.rays * 0.8));
      // Epic and up get a slow rotating corona behind the card that OUTLASTS the
      // burst — the burst says "something happened", the corona says "and it is
      // still happening", which is the half that makes a big pull feel heavy
      // rather than loud.
      if (R.rays >= 16) stage.classList.add('corona');
      // The top of the ladder rains. It is the one effect nothing below it gets.
      if (R.rays >= 24) rainDust(stage, R.color);
    }

    const pip = show.overlay.querySelectorAll('.cp-pip')[show.idx];
    if (pip) { pip.style.setProperty('--pipc', R.color); pip.classList.add('done'); }

    // The card's own lines light up one after another, so your eye is WALKED
    // through it instead of being handed a wall of text at once.
    shimmerFace(slot, R);

    // Then it waits. Fifteen seconds, or a click — see AUTO_MS.
    armAdvance();
  }, R.hold);
}

// ── the shimmer ───────────────────────────────────────────────────────────────
// Walk the server-rendered face and light its parts in reading order: the name
// first, then the rank line, then each block, then the power number. The face is
// authored server-side (`renderCard`), so this selects the classes that markup
// already emits rather than requiring the payload to describe itself — a card
// that grows a new block gets shimmered for free.
//
// The tick is a GENERATED def rather than a catalogue cue: one shape, pitched up
// the scale per line, which is a whole sequence's worth of audio out of four
// lines of code and stays in tune with itself however many blocks a card has.
const SHIMMER_ORDER = ['.card-handle', '.card-sub', '.card-marks', '.card-block', '.card-quote', '.card-power'];
const PENTATONIC = [784, 880, 1047, 1175, 1319, 1568, 1760, 2093];

function shimmerTick(i, gain = 0.05) {
  const f = PENTATONIC[Math.min(i, PENTATONIC.length - 1)];
  return { duration: 0.4, layers: [
    { waveform: 'sine', freq: f, adsr: { a: 0.004, d: 0.22, s: 0, r: 0.12 }, gain },
    { waveform: 'triangle', freq: f * 2, adsr: { a: 0.006, d: 0.14, s: 0, r: 0.08 }, gain: gain * 0.3 },
  ] };
}

function shimmerFace(slot, R) {
  const front = slot.querySelector('.cp-front');
  if (!front) return;
  // Ordered by SELECTOR, not by document order, so the name always leads even if
  // the card's markup is rearranged later.
  const parts = [];
  for (const sel of SHIMMER_ORDER) front.querySelectorAll(sel).forEach(el => parts.push(el));
  if (!parts.length) return;
  // Spread the run across the rank's dwell, floored so a Common doesn't machine-gun
  // and capped so a Legendary's tail doesn't outlast the time the card is on screen.
  const step = Math.max(150, Math.min(420, Math.round(R.dwell / (parts.length + 1))));
  parts.forEach((el, i) => {
    el.classList.add('cp-dim');
    later(() => {
      el.classList.remove('cp-dim');
      el.classList.add('cp-lit');
      sfx(shimmerTick(i, 0.035 + R.glow * 0.03));
      later(() => el.classList.remove('cp-lit'), 900);
    }, 120 + i * step);
  });
}

// The wait, and the affordance for skipping it. The bar is honest — it runs for
// exactly as long as the card has left — because a countdown you can see is the
// difference between "it moved on" and "I let it move on".
// Tracked on `show.advTimer` rather than pushed into `show.timers`, because zoom
// has to stop THIS timer without touching the reveal's pending effect cleanups —
// clearTimers() would strand `cp-lit` classes on half the card.
function armAdvance(ms = AUTO_MS) {
  if (!show) return;
  const next = show.overlay.querySelector('#cp-next');
  if (next) {
    next.classList.add('on');
    const bar = next.querySelector('i');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '100%';
      requestAnimationFrame(() => { bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%'; }); }
  }
  clearTimeout(show.advTimer);
  show.advAt = Date.now() + ms;
  show.advTimer = setTimeout(() => { if (show) nextCard(); }, ms);
}

// Gold rain, legendary and up only. Absolute in the stage so it falls past the
// card rather than inside it.
function rainDust(stage, color) {
  for (let i = 0; i < 46; i++) {
    const d = document.createElement('span');
    d.className = 'cp-dust';
    d.style.left = `${Math.random() * 100}%`;
    d.style.background = color;
    d.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
    d.style.setProperty('--d', `${2.2 + Math.random() * 2.6}s`);
    d.style.animationDelay = `${Math.random() * 1.6}s`;
    stage.appendChild(d);
    setTimeout(() => d.remove(), 6500);
  }
}

function throwMotes(host, n) {
  if (!host) return;
  for (let i = 0; i < n; i++) {
    const m = document.createElement('span');
    m.className = 'cp-mote';
    m.style.left = `${Math.random() * 100}%`;
    m.style.top = `${55 + Math.random() * 45}%`;
    m.style.setProperty('--tx', `${(Math.random() - 0.5) * 180}px`);
    m.style.setProperty('--ty', `${-120 - Math.random() * 200}px`);
    m.style.setProperty('--d', `${1 + Math.random() * 0.9}s`);
    host.appendChild(m);
    setTimeout(() => m.remove(), 2200);
  }
}

function toSummary() {
  if (!show) return;
  clearTimers();
  show.phase = 'done';
  sfx('cards-stack');
  const skip = show.overlay.querySelector('#cp-skip');
  if (skip) skip.remove();

  const best = show.cards.reduce((a, c) =>
    Object.keys(RARITY).indexOf(c.rarity) > Object.keys(RARITY).indexOf(a.rarity) ? c : a, show.cards[0]);

  show.overlay.querySelector('#cp-slot').innerHTML = `<div class="cp-summary">
      <div class="cp-sum-head" style="color:${show.hot ? '#ffc23d' : rarity(best.rarity).color}">${show.hot ? 'HOT RUN · ' : ''}${show.cards.length} CARDS · BEST PULL ${rarity(best.rarity).label}</div>
      ${show.coil ? `<div class="cp-sum-note">Off coil <b style="color:#9fd8ff">${esc(show.coil)}</b>${show.machine ? ` · ${esc(show.machine)}` : ''}</div>` : ''}
      <div class="cp-sum-grid">${show.cards.map((c, i) => {
        const R = rarity(c.rarity);
        return `<div class="cp-sum-card" data-i="${i}" style="--c:${R.color}; animation-delay:${i * 60}ms" title="Read ${esc(c.name)}">
          <div class="cp-sum-rank">${R.label}</div>
          <div class="cp-sum-name">${esc(c.name)}</div>
          <div class="cp-sum-type">${esc(c.subject_type)}</div>
          ${c.dupe ? `<div class="cp-sum-dupe">DUPLICATE</div>` : ''}
          <div class="cp-sum-read">READ ▸</div>
        </div>`;
      }).join('')}</div>
      ${show.scrapped ? `<div class="cp-sum-note">Duplicates in there — <b style="color:#c07b3a">₵${show.scrapped}</b> if you scrap them at a mint.</div>` : ''}
      <div class="cp-btns">
        <button class="cp-btn" id="cp-shelf">SEE THE SHELF</button>
        ${show.packs > 0 ? `<button class="cp-btn primary" id="cp-again">TEAR ANOTHER (${show.packs})</button>` : ''}
        <button class="cp-btn" id="cp-done">DONE</button>
      </div>
    </div>`;

  const wire = (id, fn) => show.overlay.querySelector(id)?.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  wire('#cp-done', () => show.close());
  wire('#cp-shelf', () => { show.close(); sendCmd('cards'); });
  wire('#cp-again', () => { show.close(); sendCmdSilent('openpack'); });

  // Every card in the wall is a way back into that card. The reveal moves at its
  // own pace and a player will always miss one — the summary is where they get to
  // go back and actually read it, without leaving the overlay or typing anything.
  show.overlay.querySelectorAll('.cp-sum-card').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); showDetail(Number(el.dataset.i)); });
  });
}

// One card, full size, out of the summary. Not a re-run of the reveal — no flip,
// no rays, no sound ladder: the reveal is the moment, and this is the reading
// light. Giving it the full cinematic again would cheapen the first one.
function showDetail(i) {
  if (!show) return;
  const card = show.cards[i];
  if (!card) return;
  clearTimers();
  show.phase = 'detail';
  sfx('cards-slide');
  const R = rarity(card.rarity);
  const stage = show.overlay.querySelector('#cp-stage');
  stage.style.setProperty('--cp-accent', R.color);
  stage.style.setProperty('--cp-glow', String(R.glow));

  show.overlay.querySelector('#cp-slot').innerHTML = `<div class="cp-detail">
      <div class="cp-tiltbox"><div class="cp-card-wrap cp-tilt" id="cp-wrap">
        <div class="cp-card flipped" id="cp-card">
          <div class="cp-card-side cp-back"><span class="cp-back-mark">◈</span></div>
          <div class="cp-card-side cp-front${(R.rays || 0) >= 16 ? ' holo' : ''}">${card.face || `<span class="card-face">${esc(card.name)}</span>`}
            <span class="cp-glare"></span><span class="cp-shine"><i></i></span></div>
        </div>
        ${card.subject_type === 'player' ? `<div class="cp-player-banner">PLAYER CARD</div>` : ''}
        <div class="cp-rank">${R.label}</div>
        <div class="cp-sub">${esc(card.name)} · ${esc(card.subject_type)}${card.dupe ? ` · <span class="cp-dupe-tag">DUPLICATE, ₵${show.scrapValue}</span>` : ''}</div>
      <div class="cp-zoomhint">CLICK THE CARD TO ZOOM · Z</div>
      </div></div>
      <div class="cp-btns"><button class="cp-btn" id="cp-back">◂ ALL ${show.cards.length} CARDS</button></div>
    </div>`;
  show.overlay.querySelector('#cp-back')?.addEventListener('click', (e) => { e.stopPropagation(); sfx('cards-ui'); toSummary(); });
}
