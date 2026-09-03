// Interface tour — the one bit of onboarding that isn't in the fiction.
//
// A new soul is asked, once, whether they've played a multiplayer text game
// before. If they say no, we walk the actual UI: a spotlight cuts a hole in a
// dimming overlay around one region at a time (room pane, log, command line,
// sidebar…), that region shimmers, and a small card explains what it is.
//
// Everything here is client-side. The server only (1) fires `tour_offer` on a
// first login in The Inbetween and (2) records the answer via the prologue
// plugin's `tutorial` verb, so the offer doesn't follow you to a second device.
// Replay any time with `tutorial`.
import { sendCmdSilent } from '../net.js';

const SEEN_KEY = 'interfaceTourSeen';
const TABLET_SEEN_KEY = 'tabletTourSeen';
// The tablet tour is VERSIONED, unlike the interface one. The device's home screen
// keeps changing shape — sixteen tiles to a page, pages, the toolbar, groups — and a
// walkthrough describing the old one is worse than none. Bump this when the home
// screen changes and everyone gets shown around once more; the value stored is the
// version seen, so a legacy '1' replays exactly once.
const TABLET_TOUR_VERSION = 2;

// Which layout is on screen. Same authority the stylesheet uses (main.js keeps
// html[data-density] live on resize), so the tour can never describe a control
// the player isn't actually looking at — the failure mode that makes a
// walkthrough worse than none at all.
const compact = () => document.documentElement.getAttribute('data-density') === 'compact';

// Each step spotlights one element. `sel` may list fallbacks; a step whose target
// is missing or hidden is skipped. `on` restricts a step to one layout — the two
// interfaces are different enough that a shared wording would be vague on both,
// so the phone-only controls (the collapsing room pane, the D-pad, the ≡ fan) get
// their own steps rather than a parenthetical.
const STEPS = [
  {
    sel: ['#area-pane'],
    title: 'The room',
    body: `This top pane is <b>where you are</b> — the room's description, who and what is standing in it, and the ways out. It redraws every time the room changes. Names in it are clickable: tapping one is the same as typing the command.`,
  },
  {
    // Phone-only, and the single most useful thing to know about the small
    // layout: on a handset this pane starts CLOSED, and nothing else on screen
    // says so. A player who never finds the bar thinks the game forgot to
    // describe the room.
    on: 'mobile',
    sel: ['#look-resize-handle'],
    title: 'Open the room',
    body: `On a small screen the room pane starts <b>closed</b> so the log gets the space. This bar is the handle — tap it to slide the room open (<b>▼</b>/<b>▲</b>), or drag it up and down to set the height you want. It also carries the room's name, so you always know where you're standing with the pane shut. Opening the keyboard tucks it away and reopens it after.`,
  },
  {
    sel: ['#output'],
    title: 'The log',
    body: `Everything that <b>happens</b> scrolls here — what you do, what others do, what hits you, what the world says. If you missed something, it's in here. Scroll back any time.`,
  },
  {
    sel: ['#input-area'],
    title: 'The command line',
    body: `You play by typing. <b>look</b>, <b>north</b> (or just <b>n</b>), <b>take bat</b>, <b>talk attendant</b>, <b>i</b> for inventory, <b>help</b> for the rest. Press <b>↑</b> to bring back what you typed last.`,
  },
  {
    // Phone-only. Typing directions on a handset is the fastest way to make a
    // text game feel like work; the pad exists so it doesn't have to.
    on: 'mobile',
    sel: ['#mob-dpad'],
    title: 'The D-pad',
    body: `Getting around without typing. <b>N/S/E/W</b> for the compass, <b>↑</b>/<b>↓</b> for up and down, <b>in</b>/<b>out</b> for doorways. The <b>⤢</b> in the middle cycles the pad's size — make it bigger if you're missing the buttons, or shrink it to give the log more room.`,
  },
  {
    on: 'desktop',
    sel: ['#quick-cmds'],
    title: 'Shortcuts',
    body: `The common commands, one click each — inventory, gear, who's online, help. Nothing here that you can't also type.`,
  },
  {
    on: 'mobile',
    sel: ['#cmd-fan-btn'],
    title: 'Shortcuts',
    body: `<b>≡ cmds</b> fans out the common commands — inventory, gear, who's online, help — so they're one tap instead of a typed word. Tap it again to fold them away. Next to it sits the weather, the temperature, and your own body temperature, which is worth watching in bad weather.`,
  },
  {
    on: 'mobile',
    sel: ['#mobile-chat-btn'],
    title: 'Chat',
    body: `The 💬 opens the chat channels without giving up the screen to them. It marks itself when something's arrived while you were elsewhere.`,
    optional: true,
  },
  {
    sel: ['#smart-bar'],
    title: 'The smartbar',
    body: `Your own buttons. Save any command — or a whole chain of them — as a macro and it lives down here for one-tap use. It fills up as you find things worth repeating, and it's the fastest way to reach your <b>tablet</b>.`,
    optional: true,
  },
  {
    on: 'desktop',
    sel: ['#sidebar'],
    title: 'The panels',
    body: `Down the side are <b>panels</b> — your map, your vitals, where you are, the weather, who else is here.`,
  },
  {
    on: 'desktop',
    sel: ['#minimap-section'],
    title: 'The map',
    body: `The world is a grid, and this is the piece of it around you. You're the marker in the middle. Click a tile to plot a route; the footprints button walks it for you, and <b>+</b>/<b>−</b> zoom. <b>Double-click the map</b> for the full-screen version.`,
  },
  {
    on: 'mobile',
    sel: ['#minimap-grid-hud'],
    title: 'The map',
    body: `The world is a grid, and this corner is the piece of it around you — you're the marker in the middle. <b>Tap it for the full map</b>, where you can pick a tile to plot a route and have the game walk it for you.`,
  },
  {
    on: 'desktop',
    sel: ['#vitals-section'],
    title: 'Staying alive',
    body: `Two bars, because two things are worth watching all the time: <b>health</b> and <b>stamina</b>. Everything else about your body — hunger, thirst, cold, radiation, whatever you took — has no gauge on purpose. It tells you in words instead, so read what your body says, and type <b>condition</b> for the whole picture. Eat, drink, and <b>sit</b> or <b>sleep</b> to claw it back. When health empties, you wake up in a vat, lighter than you were. (Want the instruments anyway? The hidden bars are one click away in this panel's edit mode.)`,
  },
  {
    on: 'mobile',
    sel: ['#mobile-vitals'],
    title: 'Staying alive',
    body: `Abbreviated to fit: <b>HP</b> health, <b>ST</b> stamina. That's deliberately all — hunger, thirst, cold, radiation and anything you've taken get no gauge, they tell you in words, and <b>condition</b> gives you the whole picture on demand. Eat, drink, and <b>sit</b> or <b>sleep</b> to claw it back. When health empties, you wake up in a vat, lighter than you were.`,
  },
  // ── Making it yours ───────────────────────────────────────────────────────
  // Both layouts get a customisation beat, because on both the defaults are a
  // starting point rather than the intended end state — and neither interface
  // advertises that on its own.
  {
    on: 'desktop',
    sel: ['#sidebar-header', '#sidebar'],
    title: 'Rearrange it',
    body: `The panels are yours to move. The <b>padlock</b> up here unlocks them: <b>✥</b> to drag them into whatever order you like, <b>⤢</b> to drag a panel's bottom edge and resize it, <b>↺</b> to put the sizes back. Hide the ones you never read, bring them back from <b>panels ▾</b>, and build your own — a note, a stat readout, a camera feed — with <b>＋ panel</b>. Lock it again when it looks right.`,
  },
  {
    on: 'mobile',
    sel: ['#smart-bar', '#mob-dpad'],
    title: 'Make it yours',
    body: `The small layout is adjustable too. <b>⤢</b> on the D-pad resizes it. The smartbar takes your own macros, so a command you type often becomes a button. And the room pane's height is whatever you drag it to. Anything you can't fit on screen is in the tablet.`,
  },
  {
    sel: ['#settings-btn'],
    title: 'Settings',
    body: compact()
      ? `The <b>⚙</b> holds the rest: <b>text size</b> (the one worth setting first — the layout scales to it), the colour theme, D-pad size, and <b>motion</b>, which turns off the screen effects if they make reading harder or you'd rather save the battery. The tablet's own Settings app has the same controls if the tablet's already open.`
      : `The <b>⚙</b> holds the rest: text size, the colour theme (there are several, and you can build your own), which side the panels live on, and <b>motion</b>, which turns off the screen effects if you'd rather read in peace. Worth a look now — everything here is a preference, not a difficulty setting.`,
  },
  {
    // Last, because it's the one thing here that is a whole second interface — and
    // the one thing on this list the player does NOT yet have. The interface tour
    // runs in The Inbetween; the tablet is issued at the clone vat on the other
    // side, and the bar offers its own walkthrough the moment it arrives (see
    // showTabletOffer in smartbar.js). So this step promises it and stops there:
    // opening it here would spotlight a device the fiction hasn't handed over.
    sel: ['#smart-bar', '#input-area'],
    title: 'The tablet',
    body: `Nearly everything that isn't in this window lives on a <b>tablet</b> — what you're carrying, the full map, bank, quests, messages, your record, the codex. You don't have one yet. When you do, it turns up in this bar and offers to show you round.`,
  },
];

// ── The tablet's own short tour ──────────────────────────────────────────────
// Run when the tablet first opens — which the last step of the interface tour now
// does for you, so the two read as one walkthrough with the device arriving in the
// middle of it. It stays a separate tour rather than more interface steps because
// it also has to work for a player who skipped that one, and because you cannot
// spotlight a screen that isn't on yet. #tour-overlay sits at 9700, above the
// Tablet OS at 9200, so the spotlight reaches inside it.
const TABLET_STEPS = [
  {
    sel: ['#tablet-os-overlay .tos-appgrid', '#tablet-os-overlay .tos-screen'],
    title: 'Your tablet',
    body: `Everything the interface outside doesn't have room for. Sixteen apps to a screen — <b>Map</b> for the city, <b>Gear</b> for what you're carrying and wearing, <b>Vitals</b> for how you're doing, <b>Quests</b> for what you're doing. Below those: people, money, your <b>Crime</b> record, your skills. Tap a tile to open it.`,
  },
  {
    sel: ['#tablet-os-overlay .tos-hdr'],
    title: 'The status bar',
    body: `Date, where you are, and the time — <b>tap the clock</b> to set an alarm. The bars on the right are signal: out past the city there's nothing to connect to, and the tablet says so rather than pretending.`,
  },
  {
    optional: true,
    sel: ['#tablet-os-overlay .tos-home-pager'],
    title: 'More than one screen',
    body: `Past sixteen apps the home screen <b>pages</b>. ${compact() ? 'Swipe sideways' : 'Swipe, or use the arrows and dots'} to turn it. Dragging a tile onto a dot sends that app to that page.`,
  },
  {
    sel: ['#tablet-os-overlay .tos-hbar', '#tablet-os-overlay .tos-appgrid'],
    title: 'The toolbar',
    body: `Under the grid: <b>⧉ Select</b> picks several apps at once to box them into a named, coloured group. <b>⊕ Add</b> brings back an app you've taken off the screen. <b>⌕ Find</b> searches all of them by name — quicker than remembering where you put one. <b>▤ Cards</b> turns on the info cards under the grid: where you are, what's in your pocket, the weather.`,
  },
  {
    sel: ['#tablet-os-overlay .tos-appgrid'],
    title: 'Rearrange it',
    body: compact()
      ? `<b>Press and hold</b> a tile to lift it, then drag it where you want it. Drag one clean off the tablet to stash it — <b>⊕ Add</b> has it whenever you want it back.`
      : `<b>Press and hold</b> a tile to lift it, then drag it where you want it — including into or out of a group. Drag one clean off the tablet to stash it; <b>⊕ Add</b> has it whenever you want it back.`,
  },
  {
    // On the home screen there's no breadcrumb yet, so this lands on the header —
    // still "the top of the screen", which is what the wording has to survive.
    sel: ['#tablet-os-overlay .tos-crumb', '#tablet-os-overlay .tos-hdr'],
    title: 'Getting back',
    body: `Open an app and a trail appears along the top — tap the first crumb to come back here. <b>Esc</b> closes the tablet, and so does typing <b>tablet</b> again.`,
  },
  {
    sel: ['#tablet-os-overlay .tos-appgrid'],
    title: 'Settings live here too',
    body: `The <b>Settings</b> app carries the same preferences as the <b>⚙</b> outside — text size, theme, motion${compact() ? ', D-pad size' : ''} — plus the tablet's own wallpaper and tone. Set it up once; it follows your account, not this device.`,
  },
];

let _ov = null;      // the dimming overlay (carries the cutout)
let _card = null;    // the explanation card
let _idx = 0;
let _steps = [];
let _onResize = null;
let _mode = 'interface';   // 'interface' | 'tablet' — decides how endTour finishes
let _handoff = null;       // a command the finished tour should run (see `handoff`)

const el = (sel) => (Array.isArray(sel) ? sel : [sel]).map((s) => document.querySelector(s)).find(visible);

function visible(n) {
  if (!n) return false;
  const r = n.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
}

export function hasSeenTour() {
  return localStorage.getItem(SEEN_KEY) === '1';
}

// Is a walkthrough on screen right now? Used by the smart bar's tablet chip to tell
// "the tutorial is running, it'll report back when it ends" from "nothing happened".
export function tourRunning() {
  return !!_ov;
}

// Forget having seen the tablet walkthrough. Called only from the chip the clone vat
// pops: that chip is a promise of a tutorial, so a marker left in this browser by a
// previous character must not be allowed to swallow it.
export function resetTabletTour() {
  try { localStorage.removeItem(TABLET_SEEN_KEY); } catch {}
}

// The question itself. Deliberately plain — this is the interface talking, not
// the fiction — and it only ever appears once.
export function offerInterfaceTour() {
  if (document.getElementById('tour-offer')) return;
  // Everything but the question goes dark until they've chosen. See the
  // #tour-offer-veil block in styles.css for why.
  const veil = document.createElement('div');
  veil.id = 'tour-offer-veil';
  document.body.appendChild(veil);
  const box = document.createElement('div');
  box.id = 'tour-offer';
  box.className = 'tour-card tour-offer';
  // Announced as a dialog, and NAMED by its own question. Without this it was a
  // bare <div> that no screen reader had any reason to read: focus landed on the
  // button below and the only thing spoken was "No — show me around, button" —
  // an answer with no question in front of it, on the one prompt that gates the
  // whole prologue (beginArrival holds the arrival prose until it's answered).
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'tour-offer-title');
  box.setAttribute('aria-describedby', 'tour-offer-body');
  box.innerHTML = `
    <div class="tour-card-title" id="tour-offer-title">Before you begin</div>
    <div class="tour-card-body" id="tour-offer-body">Have you played a multiplayer text game before — a MUD, a MUSH, anything you played by typing?</div>
    <div class="tour-card-actions">
      <button class="tour-btn tour-btn-ghost" data-tour-answer="yes">Yes — skip it</button>
      <button class="tour-btn" data-tour-answer="no">No — show me around</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelectorAll('[data-tour-answer]').forEach((b) => {
    b.addEventListener('click', () => {
      const answer = b.dataset.tourAnswer;
      box.remove();
      // Taking the tour hands the dimming straight over to the tour's own
      // overlay, so don't lift the veil first — that would flash the whole
      // interface up for a quarter second and then dim it again.
      if (answer === 'no') { veil.remove(); }
      else { veil.classList.add('closing'); setTimeout(() => veil.remove(), 700); }
      localStorage.setItem(SEEN_KEY, '1');
      // Bookkeeping only — silent, so the log stays in-fiction. This is also the
      // signal the server waits on before it starts speaking (see the prologue
      // plugin's `tutorial` verb): a "no tour" answer releases the arrival prose
      // immediately, a "yes" releases it when the walkthrough ends.
      sendCmdSilent(`tutorial ${answer === 'no' ? 'yes' : 'no'}`); // "no experience" ⇒ yes, tour me
      if (answer === 'no') setTimeout(startInterfaceTour, 250);
    });
  });
  box.querySelector('[data-tour-answer="no"]').focus();
}

export function startInterfaceTour() {
  if (_ov) endTour();
  localStorage.setItem(SEEN_KEY, '1');
  _mode = 'interface';
  const layout = compact() ? 'mobile' : 'desktop';
  _steps = STEPS
    .filter((s) => !s.on || s.on === layout)
    .filter((s) => el(s.sel) || !s.optional);
  _idx = 0;
  mountTour();
}

// Replayable with `tutorial tablet`; also fires itself once, from the tablet's
// own render, the first time a home screen is drawn. Refuses to run with no
// tablet on screen rather than spotlighting empty air.
export function startTabletTour() {
  if (!document.getElementById('tablet-os-overlay')) return false;
  if (_ov) endTour();
  localStorage.setItem(TABLET_SEEN_KEY, String(TABLET_TOUR_VERSION));
  _mode = 'tablet';
  _steps = TABLET_STEPS.filter((s) => el(s.sel) || !s.optional);
  if (!_steps.length) return false;
  _idx = 0;
  mountTour();
  return true;
}

// Called from tablet-os.js's render() on every home screen; does nothing after
// the first time. Deliberately not tied to the interface tour's answer — a player
// who skipped that one still gets the tablet shown to them, because the tablet is
// the half of the game you cannot discover by typing.
export function maybeTabletTour() {
  if (Number(localStorage.getItem(TABLET_SEEN_KEY)) >= TABLET_TOUR_VERSION) return;
  if (_ov) return;                       // never interrupt a tour already running
  localStorage.setItem(TABLET_SEEN_KEY, String(TABLET_TOUR_VERSION));
  setTimeout(() => startTabletTour(), 700);   // let the boot/render settle first
}

function mountTour() {

  _ov = document.createElement('div');
  _ov.id = 'tour-overlay';
  _ov.innerHTML = `<div id="tour-hole"></div>`;
  document.body.appendChild(_ov);

  _card = document.createElement('div');
  _card.className = 'tour-card';
  _card.id = 'tour-card';
  // The card IS the walkthrough — the spotlight is only pointing at what it's
  // talking about. So it's a named dialog, and focus lands on the card rather
  // than on Next: entering a dialog reads its label and description, which is
  // the step's title and body. Focusing the button instead announced "Next,
  // button" fifteen times in a row and not one word of the tour.
  _card.setAttribute('role', 'dialog');
  _card.setAttribute('aria-modal', 'true');
  _card.setAttribute('tabindex', '-1');
  _card.setAttribute('aria-labelledby', 'tour-card-title');
  _card.setAttribute('aria-describedby', 'tour-card-body');
  document.body.appendChild(_card);

  _onResize = () => showStep(_idx);
  globalThis.addEventListener('resize', _onResize);
  globalThis.addEventListener('keydown', onKey);
  showStep(0);
}

function onKey(e) {
  if (!_ov) return;
  if (e.key === 'Escape') { e.preventDefault(); endTour(); }
  else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
}

function step(delta) {
  const next = _idx + delta;
  if (next < 0) return;
  if (next >= _steps.length) { endTour(true); return; }
  showStep(next);
}

function showStep(i) {
  if (!_ov) return;
  _idx = i;
  const s = _steps[i];
  const target = el(s.sel);
  if (!target) { step(1); return; }

  // Spotlight: a transparent box over the target, its huge outer shadow doing
  // the dimming, so the region underneath stays perfectly legible.
  const r = target.getBoundingClientRect();
  const pad = 6;
  const hole = _ov.querySelector('#tour-hole');
  hole.style.left = `${Math.max(0, r.left - pad)}px`;
  hole.style.top = `${Math.max(0, r.top - pad)}px`;
  hole.style.width = `${Math.min(globalThis.innerWidth, r.width + pad * 2)}px`;
  hole.style.height = `${Math.min(globalThis.innerHeight, r.height + pad * 2)}px`;

  // The region itself shimmers once, the same visual grammar as a taught verb.
  if (document.documentElement.getAttribute('data-motion') !== 'off') {
    document.querySelectorAll('.tour-lit').forEach((n) => n.classList.remove('tour-lit'));
    target.classList.add('tour-lit');
  }

  const last = i === _steps.length - 1;
  _card.innerHTML = `
    <div class="tour-card-step">${i + 1} / ${_steps.length}</div>
    <div class="tour-card-title" id="tour-card-title">${s.title}</div>
    <div class="tour-card-body" id="tour-card-body">${s.body}</div>
    <div class="tour-card-actions">
      <button class="tour-btn tour-btn-ghost" data-tour="skip">Skip</button>
      <button class="tour-btn tour-btn-ghost" data-tour="back"${i ? '' : ' disabled'}>Back</button>
      <button class="tour-btn" data-tour="next">${s.nextLabel || (last ? 'Done' : 'Next')}</button>
    </div>`;
  _card.querySelector('[data-tour="skip"]').addEventListener('click', () => endTour());
  _card.querySelector('[data-tour="back"]').addEventListener('click', () => step(-1));
  _card.querySelector('[data-tour="next"]').addEventListener('click', () => {
    // A step can hand the walkthrough on to something it first has to OPEN. Stash it
    // for endTour: the command must go out after the lights come up, or the tablet
    // boots behind a dimming overlay that's about to be torn down anyway.
    _handoff = s.handoff || null;
    step(1);
  });
  placeCard(r);
  // Blur before focusing: the card element survives the innerHTML swap, so
  // re-focusing an element that already has focus fires no event and a screen
  // reader would read step 1's card and then silently swap to step 2's. Leaving
  // and re-entering the dialog is what makes each step announce itself. Enter /
  // → still advance (onKey is on the window), and Tab still reaches Skip, Back
  // and Next inside the card.
  _card.blur();
  _card.focus({ preventScroll: true });
}

// Put the card in the largest gap around the spotlight, clamped on screen.
function placeCard(r) {
  const w = _card.offsetWidth || 340;
  const h = _card.offsetHeight || 180;
  const gap = 16;
  const below = globalThis.innerHeight - r.bottom;
  const right = globalThis.innerWidth - r.right;
  let x, y;
  if (below >= h + gap) { y = r.bottom + gap; x = r.left; }
  else if (r.top >= h + gap) { y = r.top - h - gap; x = r.left; }
  else if (right >= w + gap) { x = r.right + gap; y = r.top; }
  else if (r.left >= w + gap) { x = r.left - w - gap; y = r.top; }
  else { x = (globalThis.innerWidth - w) / 2; y = globalThis.innerHeight - h - gap; }
  _card.style.left = `${Math.max(gap, Math.min(globalThis.innerWidth - w - gap, x))}px`;
  _card.style.top = `${Math.max(gap, Math.min(globalThis.innerHeight - h - gap, y))}px`;
}

// `finished` is true only when the player walked to the end (step() past the last
// card). Skip and Esc arrive here without it, which is how the handoff below knows
// not to open anything for someone who just asked to be left alone.
function endTour(finished) {
  globalThis.removeEventListener('resize', _onResize);
  globalThis.removeEventListener('keydown', onKey);
  document.querySelectorAll('.tour-lit').forEach((n) => n.classList.remove('tour-lit'));
  const ov = _ov;
  const mode = _mode;
  _card?.remove();
  _ov = null; _card = null; _onResize = null;

  // The tablet tour is a guest inside another overlay: it just gets out of the
  // way. None of what follows applies — there is no held-back arrival prose to
  // release, and dimming the panes behind the tablet would be theatre nobody can
  // see.
  if (mode === 'tablet') {
    ov?.remove();
    _handoff = null;
    // …and the one thing it does report: the walkthrough is over. In the prologue
    // that releases the last beat (the poster on the clone-vat wall — a nudge
    // delivered under a spotlight is a nudge nobody reads). Sent on a replay too;
    // the server side is flag- and zone-guarded, so it's a no-op everywhere else.
    sendCmdSilent('tabletdone');
    return;
  }

  // THE LIGHTS COME UP, TOP TO BOTTOM.
  //
  // The overlay used to just vanish, which dumped the whole interface on a new
  // player in one frame — every pane arriving at once, nothing telling them
  // where to look first. Now the two main panes brighten in sequence over about
  // two seconds, the room pane leading the log by a beat, so the eye lands on
  // the room description (the thing that tells you where you are) before the
  // scrollback underneath it.
  //
  // Done by fading each pane UP from dimmed rather than fading the overlay out,
  // because the overlay carries the spotlight hole — fading that would brighten
  // the hole's edges first, which is exactly backwards.
  if (ov) {
    ov.classList.add('tour-lights-up');       // kills the hole, dims flat
    for (const [i, sel] of ['#area-pane', '#output'].entries()) {
      const pane = document.querySelector(sel);
      if (!pane) continue;
      pane.classList.add('tour-dimmed');
      // 0ms for the room, 550ms for the log — the stagger IS the instruction.
      setTimeout(() => {
        pane.classList.add('tour-lit-up');
        setTimeout(() => pane.classList.remove('tour-dimmed', 'tour-lit-up'), 1700);
      }, 60 + i * 550);
    }
    setTimeout(() => ov.remove(), 500);
  }
  // Always signalled, finished or skipped. This used to fire only on a clean
  // finish, which was harmless when it was mere bookkeeping — but the server now
  // holds the arrival prose until it hears this, so a player who hits Skip or
  // Esc on step 2 would otherwise be left standing in a silent room forever.
  sendCmdSilent('tutorial done');

  // Handoff: the walkthrough's last step said "let's have a look now", so open the
  // thing — but only after the arrival monologue has actually finished landing in
  // the log, or the tablet's CRT boot covers it mid-sentence. `tutorial done` is
  // the same command that starts that monologue server-side, so we don't guess its
  // length: armTourHandoff stashes the command and waits for the server's
  // `tutorial_prose_done` signal (dispatch.js) to run it. Only on a clean finish —
  // Skip and Esc mean "leave me alone", and honouring that matters more than the
  // handoff.
  const hand = _handoff;
  _handoff = null;
  if (hand && finished) armTourHandoff(hand);
}

// Command a finished tour wants to run, once the server says it's safe to. Set by
// endTour above; consumed either by the `tutorial_prose_done` push (the normal
// path) or, if that never arrives (an old server, a dropped message), by the
// backstop timer armTourHandoff itself sets — 20s covers the slowest scripted
// arrival with room to spare, and firing twice is harmless since the second call
// finds nothing left to consume.
let _pendingHandoff = null;
function armTourHandoff(cmd) {
  _pendingHandoff = cmd;
  setTimeout(consumeTourHandoff, 20000);
}
export function consumeTourHandoff() {
  if (!_pendingHandoff) return;
  const cmd = _pendingHandoff;
  _pendingHandoff = null;
  sendCmdSilent(cmd);
}
