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
const RARITY = {
  common:    { color: '#8b98a8', glow: 0.15, rays: 0,  flash: 0,    shake: 0,    hold: 90,  dwell: 820,  sfx: 'cards-flip-common',    label: 'COMMON' },
  uncommon:  { color: '#57d47c', glow: 0.3,  rays: 0,  flash: 0.08, shake: 0,    hold: 130, dwell: 980,  sfx: 'cards-flip-uncommon',  label: 'UNCOMMON' },
  rare:      { color: '#4aa8ff', glow: 0.5,  rays: 10, flash: 0.16, shake: 0.25, hold: 240, dwell: 1500, sfx: 'cards-flip-rare',      label: 'RARE' },
  epic:      { color: '#b374ff', glow: 0.72, rays: 16, flash: 0.3,  shake: 0.55, hold: 340, dwell: 2050, sfx: 'cards-flip-epic',      label: 'EPIC' },
  legendary: { color: '#ffc23d', glow: 1,    rays: 24, flash: 0.5,  shake: 1,    hold: 460, dwell: 2750, sfx: 'cards-flip-legendary', label: 'LEGENDARY' },
  architect: { color: '#ff5470', glow: 1,    rays: 28, flash: 0.6,  shake: 1,    hold: 540, dwell: 3000, sfx: 'cards-flip-architect', label: 'ARCHITECT' },
};
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
  .cp-pack-hint { position:absolute; left:50%; bottom:-46px; transform:translateX(-50%); white-space:nowrap;
    font-size:11px; letter-spacing:3px; color:#9fd8ff; animation:cp-blink 1.5s ease-in-out infinite; }

  @keyframes cp-pack-idle { 0%,100%{transform:rotate(-2.2deg) translateY(0)} 50%{transform:rotate(2.2deg) translateY(-10px)} }
  @keyframes cp-holo { from{transform:translateX(-55%)} to{transform:translateX(55%)} }
  @keyframes cp-blink { 0%,100%{opacity:.35} 50%{opacity:1} }

  /* Tearing: the top strip rips free and spins off, the body drops and fades. */
  .cp-pack.tearing { animation:cp-pack-shake .28s ease-in-out 2; }
  .cp-pack.tearing .cp-pack-seam { animation:cp-seam-run .34s linear forwards; }
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

  /* Sparkle motes on a big pull. */
  .cp-mote { position:absolute; width:4px; height:4px; border-radius:50%; pointer-events:none; z-index:6;
    background:var(--cp-accent,#fff); box-shadow:0 0 10px var(--cp-accent,#fff);
    animation:cp-mote-rise var(--d,1.4s) ease-out forwards; }
  @keyframes cp-mote-rise { 0%{opacity:0; transform:translate(0,0) scale(.4)} 15%{opacity:1}
    100%{opacity:0; transform:translate(var(--tx),var(--ty)) scale(1.1)} }

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
  .cp-sum-card { width:118px; border-radius:7px; padding:8px; cursor:default;
    background:linear-gradient(170deg,#0c141c,#141d28);
    border:1px solid color-mix(in srgb, var(--c,#8b98a8) 60%, transparent);
    box-shadow:0 0 16px color-mix(in srgb, var(--c,#8b98a8) 22%, transparent); }
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
     steel, a lit marquee, product on real coils behind glass, and a delivery
     flap that gets hit. No scanlines — there is no tube here, the glass is
     glass, and a scanline over a shelf of merchandise reads as a bug. */
  #cardmach-overlay { position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 40%, rgba(10,16,24,0.72), rgba(2,4,7,0.9) 72%);
    backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
    font-family:'Courier New', monospace; user-select:none; }

  .vm-cab { position:relative; width:min(94vw,430px); border-radius:14px 14px 8px 8px; padding:0 0 12px;
    background:linear-gradient(100deg,#1d2b3a 0%,#16222e 22%,#101a24 55%,#16222e 88%,#0b1219 100%);
    box-shadow:0 26px 70px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.09),
      inset 0 0 0 1px rgba(0,0,0,0.6), 0 0 46px rgba(90,190,240,0.14);
    border:1px solid #05070a; }
  .vm-cab.shake { animation:vm-shake .42s cubic-bezier(.36,.07,.19,.97); }
  @keyframes vm-shake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-3px,2px)}
    35%{transform:translate(3px,-2px)} 55%{transform:translate(-2px,1px)} 78%{transform:translate(2px,0)} }

  /* Lit marquee across the crown — the chaser bulbs are the machine's pulse. */
  .vm-marquee { position:relative; display:flex; align-items:center; gap:10px; padding:10px 12px 9px;
    border-radius:13px 13px 0 0; overflow:hidden;
    background:linear-gradient(180deg,#2a1140,#3c1055 46%,#1b0a2c);
    box-shadow:inset 0 -3px 8px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.12); }
  .vm-marquee::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(90deg, rgba(255,210,120,0.85) 0 4px, transparent 4px 22px);
    height:3px; top:auto; bottom:0; animation:vm-chase 1.1s linear infinite; opacity:.75; }
  @keyframes vm-chase { to { background-position:22px 0 } }
  .vm-logo { font-size:19px; color:#ffd27a; text-shadow:0 0 14px rgba(255,190,90,0.85); animation:vm-buzz 4s ease-in-out infinite; }
  @keyframes vm-buzz { 0%,88%,100%{opacity:1} 90%{opacity:.35} 92%{opacity:1} 94%{opacity:.5} }
  .vm-names { flex:1; line-height:1.2; }
  .vm-brand { font-size:14px; font-weight:700; letter-spacing:4px; color:#ffe9c0; text-shadow:0 0 10px rgba(255,180,70,0.6); }
  .vm-model { font-size:8px; letter-spacing:3px; color:rgba(255,220,180,0.55); margin-top:3px; }
  .vm-x { background:none; border:none; color:#d9b98a; font-family:inherit; font-size:14px; cursor:pointer;
    padding:0 2px; line-height:1; }
  .vm-x:hover { color:#ff6b6b; }

  .vm-body { display:flex; gap:10px; padding:12px; }

  /* The glass. A real window: sealed frame, product inside, one raked sheen. */
  .vm-glass { position:relative; flex:1; min-height:214px; border-radius:6px; overflow:hidden; padding:10px 9px;
    background:linear-gradient(180deg,#071019,#040a10 60%,#02060a);
    box-shadow:inset 0 0 0 3px #0a1119, inset 0 0 0 4px rgba(150,220,255,0.10),
      inset 0 18px 34px rgba(0,0,0,0.75); }
  .vm-glass::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:6;
    background:linear-gradient(112deg, transparent 0 34%, rgba(200,235,255,0.13) 40%, rgba(200,235,255,0.04) 46%, transparent 56%); }
  .vm-shelf { display:flex; gap:7px; margin-bottom:9px; }
  .vm-shelf:last-of-type { margin-bottom:0; }
  .vm-slotwrap { flex:1; text-align:center; }
  .vm-code { font-size:7px; letter-spacing:2px; color:#4c6274; margin-bottom:3px; }
  /* The product: a foil sleeve stood on end, holo-swept like the real one. */
  .vm-sleeve { position:relative; height:44px; border-radius:3px; overflow:hidden;
    background:linear-gradient(150deg,#12212e,#2a5f7a 26%,#7fd8e8 42%,#123044 62%,#6b52a8 82%,#101a2a);
    box-shadow:0 3px 7px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.18); }
  .vm-sleeve::after { content:''; position:absolute; inset:-60%;
    background:linear-gradient(74deg, transparent 40%, rgba(255,255,255,0.6) 49%, transparent 58%);
    animation:cp-holo 3.2s linear infinite; mix-blend-mode:overlay; }
  .vm-sleeve i { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    font-style:normal; font-size:15px; color:#eaf6ff; text-shadow:0 1px 5px rgba(0,0,0,0.9); z-index:2; }
  .vm-slotwrap.out .vm-sleeve { background:#0a1219; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06); }
  .vm-slotwrap.out .vm-sleeve::after, .vm-slotwrap.out .vm-sleeve i { display:none; }
  /* The coil the sleeve sits on. It turns when the machine vends. */
  .vm-coil { height:9px; margin-top:2px;
    background:repeating-linear-gradient(72deg, #7c8b99 0 2px, #303c47 2px 6px);
    border-radius:0 0 3px 3px; box-shadow:inset 0 -2px 4px rgba(0,0,0,0.7); }
  .vm-slotwrap.turning .vm-coil { animation:vm-coil .55s linear 2; }
  @keyframes vm-coil { to { background-position:22px 0 } }
  .vm-tag { font-size:8px; letter-spacing:1px; color:#9fd8ff; margin-top:3px; }
  .vm-slotwrap.out .vm-tag { color:#54646f; }

  /* The falling sleeve — one node, reused, animated down the glass into the flap. */
  .vm-drop { position:absolute; z-index:5; width:52px; height:44px; border-radius:3px; opacity:0; pointer-events:none;
    background:linear-gradient(150deg,#12212e,#2a5f7a 26%,#7fd8e8 42%,#123044 62%,#6b52a8 82%,#101a2a);
    box-shadow:0 6px 16px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.2); }
  .vm-drop.fall { animation:vm-fall 1.05s cubic-bezier(.45,.05,.6,1) forwards; }
  @keyframes vm-fall {
    0%   { opacity:1; transform:translate(0,0) rotate(0deg) }
    18%  { opacity:1; transform:translate(6px,10px) rotate(9deg) }
    62%  { opacity:1; transform:translate(-4px,150px) rotate(-24deg) }
    76%  { opacity:1; transform:translate(0,178px) rotate(-8deg) }
    86%  { opacity:1; transform:translate(2px,164px) rotate(4deg) }
    100% { opacity:0; transform:translate(0,190px) rotate(0deg) }
  }

  /* Right-hand control column: price plate, odds board, balance, buttons. */
  .vm-side { width:126px; display:flex; flex-direction:column; gap:8px; }
  .vm-plate { padding:7px 8px; border-radius:4px; text-align:center;
    background:linear-gradient(180deg,#0f1720,#080d13); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 5px rgba(0,0,0,0.7); }
  .vm-plate-lbl { font-size:7px; letter-spacing:2px; color:#5d7d8d; }
  .vm-plate-val { font-size:17px; color:#9ff0ff; text-shadow:0 0 12px rgba(90,220,255,0.6); }
  .vm-odds { display:flex; gap:3px; align-items:flex-end; height:36px; padding:0 2px; }
  .vm-odd { flex:1; text-align:center; }
  .vm-odd-bar { height:24px; display:flex; align-items:flex-end; justify-content:center; }
  .vm-odd-bar i { display:block; width:74%; border-radius:1px 1px 0 0; background:var(--c,#8b98a8);
    box-shadow:0 0 8px var(--c,#8b98a8); }
  .vm-odd-lbl { font-size:7px; letter-spacing:1px; color:#5d7d8d; margin-top:3px; }
  .vm-note { font-size:8px; letter-spacing:1px; color:#5d7d8d; text-align:center; }
  /* Physical pushbuttons — they travel when pressed. */
  .vm-btn { font-family:inherit; font-size:10px; letter-spacing:2px; padding:9px 6px; cursor:pointer; border-radius:5px;
    color:#a9c4d8; border:1px solid rgba(120,190,240,0.3);
    background:linear-gradient(180deg,#1a2937,#0c1219); box-shadow:0 3px 0 #05080c, inset 0 1px 0 rgba(255,255,255,0.08);
    transition:transform .06s, box-shadow .06s; }
  .vm-btn:hover:not(:disabled) { color:#eaf6ff; border-color:rgba(160,225,255,0.75); }
  .vm-btn:active:not(:disabled) { transform:translateY(3px); box-shadow:0 0 0 #05080c, inset 0 1px 0 rgba(255,255,255,0.08); }
  .vm-btn.primary { color:#04121a; background:linear-gradient(180deg,#7fe8ff,#37a8d8); border-color:#9ff0ff; font-weight:700;
    box-shadow:0 3px 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5); }
  .vm-btn.primary:active:not(:disabled) { box-shadow:0 0 0 #145a75, inset 0 1px 0 rgba(255,255,255,0.5); }
  .vm-btn:disabled { opacity:.38; cursor:not-allowed; }

  /* The delivery flap. It gets HIT — the kick is what sells the vend. */
  .vm-hatch { margin:0 12px; border-radius:5px; padding:5px;
    background:linear-gradient(180deg,#0e151c,#070b10); box-shadow:inset 0 2px 6px rgba(0,0,0,0.9); }
  .vm-flap { height:34px; border-radius:3px; display:flex; align-items:center; justify-content:center;
    font-size:8px; letter-spacing:3px; color:#4a5a68; transform-origin:50% 0%;
    background:linear-gradient(180deg,#131c25,#080e14 70%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -8px 14px rgba(0,0,0,0.85); }
  .vm-flap.kick { animation:vm-kick .5s ease-out; }
  @keyframes vm-kick { 0%{transform:rotateX(0)} 30%{transform:rotateX(52deg)} 60%{transform:rotateX(-8deg)} 100%{transform:rotateX(0)} }
  .vm-tray { margin:8px 12px 0; height:24px; border-radius:3px; display:flex; align-items:center; justify-content:center;
    font-size:8px; letter-spacing:3px; color:#3d4d5d;
    background:linear-gradient(180deg,#05080c,#0d141b); box-shadow:inset 0 3px 9px rgba(0,0,0,0.9); }
  .vm-tray.loaded { color:#7fe8ff; text-shadow:0 0 10px rgba(127,232,255,0.7); animation:cp-blink 1.6s ease-in-out infinite; }
  .vm-dead { color:#5d6d7d; text-align:center; padding:60px 10px; letter-spacing:2px; font-size:11px; line-height:1.7; }

  @media (prefers-reduced-motion: reduce) {
    #cardpack-overlay *, #cardmach-overlay * { animation-duration:.01ms !important; animation-iteration-count:1 !important;
      transition-duration:.01ms !important; }
  }
  `;
  document.head.appendChild(s);
}

// ── the machine ───────────────────────────────────────────────────────────────
let machine = null;   // { overlay, close, data }

export function openCardMachinePanel(msg) {
  ensurePackStyles();
  if (machine) machine.close();

  const mounted = mountOverlay({
    id: 'cardmach-overlay',
    html: `<div class="vm-cab" id="vm-cab">
      <div class="vm-marquee">
        <span class="vm-logo">◈</span>
        <div class="vm-names">
          <div class="vm-brand">COLDWATER MINT</div>
          <div class="vm-model">${esc(String(msg.machine || 'CARD DISPENSER')).toUpperCase()}</div>
        </div>
        <button class="vm-x" aria-label="Close">&#10005;</button>
      </div>
      <div class="vm-body">
        <div class="vm-glass" id="vm-glass"><div class="vm-drop" id="vm-drop"></div></div>
        <div class="vm-side" id="vm-side"></div>
      </div>
      <div class="vm-hatch"><div class="vm-flap" id="vm-flap">PUSH</div></div>
      <div class="vm-tray" id="vm-tray">EMPTY TRAY</div>
    </div>`,
    onClose: () => { machine = null; },
  });
  machine = { ...mounted, data: msg };
  mounted.overlay.querySelector('.vm-x').addEventListener('click', () => mounted.close());
  renderMachine();
  // Delegated, because the side column is re-rendered on every patch and its
  // buttons are new nodes each time. The buttons send the ordinary verbs and
  // nothing here transacts — the server re-checks power, price and balance
  // exactly as it would for a typed command.
  mounted.overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('#vm-buy, #vm-open');
    if (!btn || btn.disabled) return;
    if (btn.id === 'vm-open') { mounted.close(); sendCmdSilent('openpack'); return; }
    sendCmdSilent('buypack confirm');
  });
  sfx('cards-slide');
}

// Live patch after a vend — the panel stays open so you can buy a second sleeve
// without walking away and back.
export function updateCardMachine(patch) {
  if (!machine) return;
  Object.assign(machine.data, patch);
  renderMachine();
}

export function closeCardMachine() { machine?.close(); }
export function isCardMachineOpen() { return !!machine; }

// Three shelves of three, with the last column dark: a real machine is never
// evenly stocked, and an empty row is what makes the full ones read as product.
// Row A is the one that vends, so the drop always starts from a slot you watched.
const SHELVES = [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']];
const isOut = (code) => code === 'A3' || code === 'C2';

function renderMachine() {
  if (!machine) return;
  const d = machine.data;
  const glass = machine.overlay.querySelector('#vm-glass');
  const side = machine.overlay.querySelector('#vm-side');
  const total = d.pool?.total || 0;

  // The drop node survives a re-render — a patch arriving mid-fall must not
  // delete the sleeve out of the air.
  const drop = machine.overlay.querySelector('#vm-drop');
  if (!total) {
    glass.innerHTML = `<div class="vm-dead">— NO STOCK —<br><br>Nobody has minted anything yet.<br>Every coil behind the glass is bare.</div>`;
  } else {
    glass.innerHTML = SHELVES.map(row =>
      `<div class="vm-shelf">` + row.map(code => {
        const out = isOut(code);
        return `<div class="vm-slotwrap${out ? ' out' : ''}" data-code="${code}">` +
          `<div class="vm-code">${code}</div>` +
          `<div class="vm-sleeve"><i>◈</i></div><div class="vm-coil"></div>` +
          `<div class="vm-tag">${out ? 'OUT' : '₵' + d.price}</div></div>`;
      }).join('') + `</div>`).join('');
  }
  glass.appendChild(drop);

  const by = d.pool?.byRank || {};
  const ranks = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  // The odds board is drawn from the LIVE pool, so a rank nobody has minted
  // shows as a flat nub rather than an advertised chance that cannot pay out.
  const max = Math.max(1, ...ranks.map(r => by[r] || 0));
  const packs = d.packs || 0;
  side.innerHTML =
    `<div class="vm-plate"><div class="vm-plate-lbl">YOUR CREDIT</div>` +
      `<div class="vm-plate-val">₵${(d.credits ?? 0).toLocaleString()}</div></div>` +
    `<div class="vm-note">IN THE POOL — ${total}</div>` +
    `<div class="vm-odds">` + ranks.map(r => {
      const n = by[r] || 0;
      const h = n ? Math.max(3, Math.round((n / max) * 24)) : 2;
      return `<div class="vm-odd" style="--c:${rarity(r).color}">` +
        `<div class="vm-odd-bar"><i style="height:${h}px"></i></div>` +
        `<div class="vm-odd-lbl">${rarity(r).label.slice(0, 4)}</div></div>`;
    }).join('') + `</div>` +
    `<div class="vm-note">BUY-BACK ₵${d.scrapValue} A DUPE</div>` +
    `<button class="vm-btn primary" id="vm-buy"${!total || (d.credits ?? 0) < d.price ? ' disabled' : ''}>BUY · ₵${d.price}</button>` +
    `<button class="vm-btn" id="vm-open"${packs < 1 ? ' disabled' : ''}>TEAR ONE OPEN</button>`;

  const tray = machine.overlay.querySelector('#vm-tray');
  tray.classList.toggle('loaded', packs > 0);
  tray.textContent = packs ? `${packs} UNOPENED SLEEVE${packs === 1 ? '' : 'S'} ON YOU` : 'EMPTY TRAY';
}

// The vend response: run the hardware, patch the panel, and let the log line
// through. The offer to open it NOW is the tray lighting up — you are already
// standing at the machine, so a second modal on top would be noise.
//
// The animation is a REPORT, never a promise: it only runs on the server's vend
// message, so a refused buy (no power, no credit) shows nothing falling.
export function cardMachineVend(msg) {
  sfx('cards-vend');
  if (machine) { updateCardMachine({ credits: msg.credits, packs: msg.packs }); playVend(); }
  refreshInventory();
}

// Coil turns, sleeve tips off the shelf, falls the height of the glass, and the
// flap takes the hit. Purely cosmetic — the sleeve was already in your inventory
// before the first frame drew.
function playVend() {
  const ov = machine?.overlay;
  if (!ov) return;
  const slot = ov.querySelector('.vm-slotwrap[data-code="A1"]');
  const drop = ov.querySelector('#vm-drop');
  const flap = ov.querySelector('#vm-flap');
  const cab = ov.querySelector('#vm-cab');
  if (!slot || !drop) return;

  slot.classList.remove('turning');
  void slot.offsetWidth;
  slot.classList.add('turning');

  // Start the falling sleeve exactly where the shelved one sits, so the product
  // appears to leave the coil rather than spawn in the middle of the window.
  const g = ov.querySelector('#vm-glass').getBoundingClientRect();
  const s = slot.querySelector('.vm-sleeve').getBoundingClientRect();
  drop.style.left = `${s.left - g.left}px`;
  drop.style.top = `${s.top - g.top}px`;
  drop.style.width = `${s.width}px`;
  drop.classList.remove('fall');
  void drop.offsetWidth;
  drop.classList.add('fall');

  setTimeout(() => {
    flap?.classList.remove('kick');
    void flap?.offsetWidth;
    flap?.classList.add('kick');
    cab?.classList.remove('shake');
    void cab?.offsetWidth;
    cab?.classList.add('shake');
    sfx('cards-slide');
  }, 620);
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
    onKey: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); } },
    html: `<div class="cp-stage" id="cp-stage">
        <div class="cp-ambient" id="cp-ambient"></div>
        <div class="cp-flash" id="cp-flash"></div>
        <div id="cp-slot"></div>
        <div class="cp-pips" id="cp-pips"></div>
      </div>
      <div class="cp-skip" id="cp-skip">SKIP ▸</div>`,
    onClose: () => { clearTimers(); show = null; },
  });

  show = {
    ...mounted, cards, idx: -1, phase: 'sealed', timers: [],
    scrapped: msg.scrapped || 0, scrapValue: msg.scrapValue || 0, packs: msg.packs || 0,
  };

  mounted.overlay.querySelector('#cp-skip').addEventListener('click', (e) => { e.stopPropagation(); toSummary(); });
  // Anywhere on the stage advances. One affordance, always the same one.
  mounted.overlay.addEventListener('click', () => advance());
  renderPips();
  renderSealed();
  refreshInventory();
}

function clearTimers() { if (show) { show.timers.forEach(clearTimeout); show.timers = []; } }
function later(fn, ms) { if (show) show.timers.push(setTimeout(fn, ms)); }

function advance() {
  if (!show) return;
  if (show.phase === 'sealed') { tear(); return; }
  if (show.phase === 'revealing') { clearTimers(); nextCard(); return; }
  if (show.phase === 'dealt') { clearTimers(); nextCard(); return; }
}

function renderPips() {
  const pips = show.overlay.querySelector('#cp-pips');
  pips.innerHTML = show.cards.map(() => `<span class="cp-pip"></span>`).join('');
}

function renderSealed() {
  const slot = show.overlay.querySelector('#cp-slot');
  slot.innerHTML = `<div class="cp-pack" id="cp-pack">
      <div class="cp-pack-body"></div>
      <div class="cp-pack-top"></div>
      <div class="cp-pack-seam"></div>
      <div class="cp-pack-print">
        <div class="cp-pack-mark">◈</div>
        <div class="cp-pack-brand">COLDWATER</div>
        <div class="cp-pack-sub">MINT · SERIES 1</div>
        <div class="cp-pack-count">FOIL SLEEVE</div>
      </div>
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
  later(() => {
    pack.classList.add('torn');
    throwFlecks(pack);
  }, 320);
  later(() => { show.phase = 'revealing'; nextCard(); }, 1000);
}

// Foil comes off in bits. Positions and vectors are random per tear so two
// openings never look identical — the cards are the only thing that repeats.
function throwFlecks(host) {
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('span');
    f.className = 'cp-fleck';
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

  stage.style.setProperty('--cp-accent', R.color);
  stage.style.setProperty('--cp-glow', String(R.glow));
  stage.style.setProperty('--cp-flash', String(R.flash));
  stage.style.setProperty('--cp-shake', String(R.shake));

  slot.innerHTML = `<div class="cp-card-wrap">
      <div class="cp-rays" id="cp-rays">${Array.from({ length: R.rays }, (_, i) =>
        `<span class="cp-ray" style="transform:rotate(${(360 / Math.max(1, R.rays)) * i}deg) translateX(-50%)"></span>`).join('')}</div>
      <div class="cp-card" id="cp-card">
        <div class="cp-card-side cp-back"><span class="cp-back-mark">◈</span></div>
        <div class="cp-card-side cp-front">${card.face || `<span class="card-face">${esc(card.name)}</span>`}</div>
      </div>
      ${card.subject_type === 'player' ? `<div class="cp-player-banner">PLAYER CARD</div>` : ''}
      <div class="cp-rank">${R.label}</div>
      <div class="cp-sub">${esc(card.name)} · ${esc(card.subject_type)}${card.dupe ? ` · <span class="cp-dupe-tag">DUPLICATE, ₵${show.scrapValue}</span>` : ''}</div>
    </div>`;

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

    ambient.style.opacity = String(0.06 + R.glow * 0.2);
    show.overlay.querySelector('#cp-flash').classList.add('on');
    later(() => show?.overlay.querySelector('#cp-flash')?.classList.remove('on'), 520);

    if (isBig(card.rarity)) {
      slot.querySelector('#cp-rays')?.classList.add('on');
      if (R.shake) { stage.classList.add('shake'); later(() => stage.classList.remove('shake'), 460); }
      throwMotes(slot.querySelector('.cp-card-wrap'), Math.round(R.rays * 0.8));
    }

    const pip = show.overlay.querySelectorAll('.cp-pip')[show.idx];
    if (pip) { pip.style.setProperty('--pipc', R.color); pip.classList.add('done'); }

    // Auto-advance after the dwell. Clicking early skips ahead; nothing waits on
    // input, so a player can watch the whole sleeve without touching anything.
    later(() => nextCard(), R.dwell);
  }, R.hold);
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
      <div class="cp-sum-head" style="color:${rarity(best.rarity).color}">${show.cards.length} CARDS · BEST PULL ${rarity(best.rarity).label}</div>
      <div class="cp-sum-grid">${show.cards.map(c => {
        const R = rarity(c.rarity);
        return `<div class="cp-sum-card" style="--c:${R.color}">
          <div class="cp-sum-rank">${R.label}</div>
          <div class="cp-sum-name">${esc(c.name)}</div>
          <div class="cp-sum-type">${esc(c.subject_type)}</div>
          ${c.dupe ? `<div class="cp-sum-dupe">DUPLICATE</div>` : ''}
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
}
