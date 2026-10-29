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
import { openTabletToBinder } from './lazy-views.js';
import { loadCss } from '../../../shared/dom.js';
import { ensureSportCards } from './sportcard.js';

// cardpack.css ships beside this file and is fetched when the module loads, so ensurePackStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const PACK_CSS = await loadCss(new URL('./cardpack.css', import.meta.url));

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
  s.textContent = PACK_CSS;
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
function vmModel(name, brand = VM_BRAND) {
  const s = String(name || 'card dispenser').trim();
  const bare = s.replace(new RegExp(`^${brand}\\s*`, 'i'), '').trim();
  return bare || s;
}

let machine = null;   // { overlay, close, data, pick, busy, justVended }

// Three shelves of three. Codes are the SERVER's — the panel never invents a
// coil, because the coil you press has to be the coil the verb charges you for.
const SHELVES = [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']];
const slotOf = (d, code) => (d.slots || []).find(s => s.code === code) || { code, left: 0, cap: 8 };
const stockedCodes = (d) => (d.slots || []).filter(s => s.left > 0).map(s => s.code);
const reduceMotion = () => prefersReducedMotion();

// A league's machine (plugins/cards/sports-verbs.js) sends its own brand, tagline, hint and
// verbs; a Draft machine sends none and gets the Draft's.
export function openCardMachinePanel(msg) {
  ensurePackStyles();
  const brand = msg.brand || VM_BRAND;
  if (machine) machine.close();

  const mounted = mountOverlay({
    id: 'cardmach-overlay',
    html: `<div class="vm-cab" id="vm-cab">
      <div class="vm-marquee">
        <span class="vm-logo">◈</span>
        <div class="vm-names">
          <div class="vm-brand">${esc(brand)}</div>
          <div class="vm-model">${esc(vmModel(msg.machine, brand)).toUpperCase()} · ${esc(msg.tagline || VM_TAGLINE)}</div>
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
      <div class="vm-hint">${msg.hint ? esc(msg.hint) : `Every sleeve on these coils is already what it is. About one in twelve runs HOT, triple
        weight on epic and legendary, and nothing on the outside of a sleeve will ever tell you which.`}</div>
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
    // Read the verb before closing: onClose nulls `machine`.
    if (btn.id === 'vm-open') { const cmd = machine.data.openCmd || 'openpack'; mounted.close(); sendCmdSilent(cmd); return; }
    // The coil travels with the verb. A typed `buypack confirm` with no code is
    // still valid — the server falls back to the fullest coil — so the panel and
    // the keyboard reach the same machine.
    sendCmdSilent(`${machine.data.buyCmd || 'buypack'} confirm${machine.pick ? ' ' + machine.pick : ''}`);
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

function renderMachine() {
  if (!machine) return;
  const d = machine.data;
  const shelves = machine.overlay.querySelector('#vm-shelves');
  const side = machine.overlay.querySelector('#vm-side');
  const mech = machine.overlay.querySelector('#vm-mech');
  const total = d.pool?.total || 0;
  const stocked = stockedCodes(d).length;

  if (!total) {
    shelves.innerHTML = `<div class="vm-dead">NO STOCK<br><br>Nobody has minted anything yet.<br>Every coil behind the glass is bare.</div>`;
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
    `<div class="vm-note">IN THE POOL: ${total}</div>` +
    `<div class="vm-odds">` + ranks.map(r => {
      const n = by[r] || 0;
      const h = n ? Math.max(3, Math.round((n / max) * 30)) : 2;
      return `<div class="vm-odd" style="--c:${rarity(r).color}">` +
        `<div class="vm-odd-bar"><i style="height:${h}px"></i></div>` +
        `<div class="vm-odd-lbl">${rarity(r).label.slice(0, 4)}</div></div>`;
    }).join('') + `</div>` +
    (d.scrapValue ? `<div class="vm-note">BUY-BACK ₵${d.scrapValue} A DUPE</div>` : '') +
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

export function openPackReveal(msg) {
  ensurePackStyles();
  if (msg.league) ensureSportCards();
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
    // a league sleeve's own print, the verb that tears another and its Binder page
    brand: msg.brand || VM_BRAND, sub: msg.sub || 'SERIES 1', againCmd: msg.againCmd || 'openpack', shelfScreen: msg.shelfScreen || null,
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
        <div class="cp-pack-brand">${esc(show.brand)}</div>
        <div class="cp-pack-sub">${esc(show.sub)} · SEALED</div>
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
      ${show.scrapped ? `<div class="cp-sum-note">Duplicates in there: <b style="color:#c07b3a">₵${show.scrapped}</b> if you scrap them at a mint.</div>` : ''}
      <div class="cp-btns">
        <button class="cp-btn" id="cp-shelf">SEE THE SHELF</button>
        ${show.packs > 0 ? `<button class="cp-btn primary" id="cp-again">TEAR ANOTHER (${show.packs})</button>` : ''}
        <button class="cp-btn" id="cp-done">DONE</button>
      </div>
    </div>`;

  const wire = (id, fn) => show.overlay.querySelector(id)?.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  wire('#cp-done', () => show.close());
  // SEE THE SHELF opens the BINDER, not the log. See openTabletToBinder: the
  // reveal has just shown these as objects and the follow-through has to be the
  // surface where they stay objects.
  wire('#cp-shelf', () => { const page = show.shelfScreen; show.close(); openTabletToBinder(page); });
  wire('#cp-again', () => { const cmd = show.againCmd; show.close(); sendCmdSilent(cmd); });

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
