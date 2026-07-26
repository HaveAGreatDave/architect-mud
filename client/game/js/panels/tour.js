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

// Each step spotlights one element. `sel` may list fallbacks (mobile layouts
// carry different nodes); a step whose target is missing or hidden is skipped.
const STEPS = [
  {
    sel: ['#area-pane'],
    title: 'The room',
    body: `This top pane is <b>where you are</b> — the room's description, who and what is standing in it, and the ways out. It redraws every time the room changes. Names in it are clickable: tapping one is the same as typing the command.`,
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
    sel: ['#quick-cmds', '#cmd-fan-btn'],
    title: 'Shortcuts',
    body: `The common commands, one tap each — inventory, gear, who's online, help. Nothing here that you can't also type.`,
  },
  {
    sel: ['#smart-bar'],
    title: 'The smartbar',
    body: `Your own buttons. Save any command — or a whole chain of them — as a macro and it lives down here for one-tap use. It fills up as you find things worth repeating.`,
    optional: true,
  },
  {
    sel: ['#sidebar'],
    title: 'The panels',
    body: `Down the side are <b>panels</b> — your map, your vitals, where you are, the weather, who else is here. They're yours to arrange: unlock with the padlock at the top to drag them into order or resize them, hide the ones you don't want, and add your own with <b>＋ panel</b>.`,
  },
  {
    sel: ['#minimap-section', '#minimap-grid-hud'],
    title: 'The map',
    body: `The world is a grid, and this is the piece of it around you. You're the marker in the middle. Click a tile to plot a route; the footprints button walks it for you.`,
  },
  {
    sel: ['#vitals-section', '#mobile-vitals'],
    title: 'Staying alive',
    body: `Health, sanity, hunger, thirst, stamina. They all drift the wrong way on their own — eat, drink, and <b>sit</b> or <b>sleep</b> to get them back. When health empties, you wake up in a vat, lighter than you were.`,
  },
];

let _ov = null;      // the dimming overlay (carries the cutout)
let _card = null;    // the explanation card
let _idx = 0;
let _steps = [];
let _onResize = null;

const el = (sel) => (Array.isArray(sel) ? sel : [sel]).map((s) => document.querySelector(s)).find(visible);

function visible(n) {
  if (!n) return false;
  const r = n.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
}

export function hasSeenTour() {
  return localStorage.getItem(SEEN_KEY) === '1';
}

// The question itself. Deliberately plain — this is the interface talking, not
// the fiction — and it only ever appears once.
export function offerInterfaceTour() {
  if (document.getElementById('tour-offer')) return;
  const box = document.createElement('div');
  box.id = 'tour-offer';
  box.className = 'tour-card tour-offer';
  box.innerHTML = `
    <div class="tour-card-title">Before you begin</div>
    <div class="tour-card-body">Have you played a multiplayer text game before — a MUD, a MUSH, anything you played by typing?</div>
    <div class="tour-card-actions">
      <button class="tour-btn tour-btn-ghost" data-tour-answer="yes">Yes — skip it</button>
      <button class="tour-btn" data-tour-answer="no">No — show me around</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelectorAll('[data-tour-answer]').forEach((b) => {
    b.addEventListener('click', () => {
      const answer = b.dataset.tourAnswer;
      box.remove();
      localStorage.setItem(SEEN_KEY, '1');
      // Bookkeeping only — silent, so the log stays in-fiction.
      sendCmdSilent(`tutorial ${answer === 'no' ? 'yes' : 'no'}`); // "no experience" ⇒ yes, tour me
      if (answer === 'no') setTimeout(startInterfaceTour, 250);
    });
  });
  box.querySelector('[data-tour-answer="no"]').focus();
}

export function startInterfaceTour() {
  if (_ov) endTour();
  localStorage.setItem(SEEN_KEY, '1');
  _steps = STEPS.filter((s) => el(s.sel) || !s.optional);
  _idx = 0;

  _ov = document.createElement('div');
  _ov.id = 'tour-overlay';
  _ov.innerHTML = `<div id="tour-hole"></div>`;
  document.body.appendChild(_ov);

  _card = document.createElement('div');
  _card.className = 'tour-card';
  _card.id = 'tour-card';
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
    <div class="tour-card-title">${s.title}</div>
    <div class="tour-card-body">${s.body}</div>
    <div class="tour-card-actions">
      <button class="tour-btn tour-btn-ghost" data-tour="skip">Skip</button>
      <button class="tour-btn tour-btn-ghost" data-tour="back"${i ? '' : ' disabled'}>Back</button>
      <button class="tour-btn" data-tour="next">${last ? 'Done' : 'Next'}</button>
    </div>`;
  _card.querySelector('[data-tour="skip"]').addEventListener('click', () => endTour());
  _card.querySelector('[data-tour="back"]').addEventListener('click', () => step(-1));
  _card.querySelector('[data-tour="next"]').addEventListener('click', () => step(1));
  placeCard(r);
  _card.querySelector('[data-tour="next"]').focus();
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

function endTour(finished = false) {
  globalThis.removeEventListener('resize', _onResize);
  globalThis.removeEventListener('keydown', onKey);
  document.querySelectorAll('.tour-lit').forEach((n) => n.classList.remove('tour-lit'));
  _ov?.remove(); _card?.remove();
  _ov = null; _card = null; _onResize = null;
  if (finished) sendCmdSilent('tutorial done');
}
