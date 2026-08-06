// Gameday · Rink — the animated sub-screen for the CLUSTER PUCK (CPhL) broadcast.
//
// Same contract as gameday.js (the Deadball diamond): placement-agnostic, renders a
// per-beat `gameday` payload into whatever host it's handed, and exposes the identical
// { apply, clear, setCaption, showIdle, showCard } interface — which is what lets tv.js
// pick a view by sport and change nothing else. A future tablet app mounts it unchanged.
//
// WHAT IT PLAYS BACK. The payload carries the sim's own possession keyframes — a sparse
// chain of {t, p:[x,y], ev, carrier} the server already generated and every client
// splines identically. Nothing here decides anything: the outcome arrived decided, and
// this module's whole job is to make the decided thing legible.
//
// ── THREE THINGS THIS VIEW IS, AND WHY ────────────────────────────────────────────
//
// THE SHEET RUNS VERTICALLY, AND THE CAMERA CHASES THE PUCK. The panel is a landscape
// box; a whole 200×85 sheet drawn end-to-end across it puts every man at three pixels
// and makes the sport unreadable — which is exactly the problem NHL '94 solved by
// standing the rink up and scrolling a zoomed camera along its length. So the sheet is
// drawn TALL and LARGER THAN THE VIEWPORT, and `.gdr-cam` slides under a clipping
// window to keep the puck in frame. You see a zone and a bit, at a size where a man
// reads as a man.
//
// THE MODEL FRAME NEVER ROTATES. The sim's keyframes are `x` along the sheet and `y`
// across it, and so are GEO and DOTS. Standing the rink up is a PROJECTION applied at
// the very edge — `_sx`/`_sy` — and nothing upstream of those two functions knows the
// picture is vertical. Rotating the model instead would have meant reinterpreting every
// coordinate the server sends, which is the one thing a view must never do.
//
// THE ICE IS NEVER STILL. A beat of play arrives about every ten seconds; the old view
// animated the beat and then froze on its last frame for the other nine, which reads as
// a photograph of hockey rather than hockey. Now a rAF loop owns every token: ten
// skaters hold a formation RELATIVE TO THE PUCK, drift with their own seeded wander,
// and the puck keeps circulating through an idle flow between beats. When a beat lands
// it simply takes the puck over — the ice was already alive, and goes back to being
// alive when the beat resolves. The idle flow is COSMETIC and decides nothing: no goal,
// no shot, no stat ever comes out of it.
//
// THE GOALIE IS THE POINT. He is an articulated SVG — mask, chest, blocker, glove, two
// pads, stick — not a dot, because every save type in the sim is a DIFFERENT save and
// a top-down blob can't tell you which. He tracks the puck along his crease while play
// develops, then plays the shot the way the sim says it was played: chest, glove, pad,
// poke, or beaten.

import { cphlMark, cphlLockup } from './cphl-brand.js';

function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── rink geometry (fractions of the sheet, MODEL frame) ─────────────────────────
// `x` runs the LENGTH of the sheet (0 = the away end, 1 = the home end), `y` runs
// across it. This is the sim's own frame — see the possession keyframes — and it is
// deliberately independent of which way the picture is turned.
const GEO = {
  goalLine: [0.075, 0.925],       // the line the puck must fully cross
  cageBack: [0.025, 0.975],       // back mesh — where a scored puck actually stops
  blue: [0.365, 0.635],
  centre: 0.5,
  dotY: [0.26, 0.74],             // the two dot rows
  endDotX: [0.20, 0.80],
  neutralDotX: [0.415, 0.585],
  creaseR: 0.075,
  netHalf: 0.085,                 // half the goal mouth, in y
};

// Dot id → [x, y]. The ids are the sim's, and this table is the ONLY place that knows
// where they are; hockey.js deliberately doesn't carry coordinates.
const DOTS = {
  C:   [GEO.centre, 0.5],
  aZL: [GEO.endDotX[0], GEO.dotY[0]], aZR: [GEO.endDotX[0], GEO.dotY[1]],
  hZL: [GEO.endDotX[1], GEO.dotY[0]], hZR: [GEO.endDotX[1], GEO.dotY[1]],
  aNL: [GEO.neutralDotX[0], GEO.dotY[0]], aNR: [GEO.neutralDotX[0], GEO.dotY[1]],
  hNL: [GEO.neutralDotX[1], GEO.dotY[0]], hNR: [GEO.neutralDotX[1], GEO.dotY[1]],
};

// ── the projection ──────────────────────────────────────────────────────────────
// Model → sheet. The sheet SVG is authored at the real 85×200 so a faceoff circle is
// a CIRCLE: the viewBox already carries the sheet's true proportions, so nothing is
// stretched and no shape has to be pre-distorted to survive the box.
//
// The away end (model x = 0) lands at the TOP of the picture, which is the frame the
// sim's `winnerSide` and its dot ids are already computed in.
const SHEET_W = 85, SHEET_L = 200;
const _sx = (y) => (1 - y) * SHEET_W;     // across the sheet → screen x
const _sy = (x) => x * SHEET_L;           // along the sheet  → screen y
// The same projection as a percentage, for the DOM tokens that live over the SVG.
const _px = (y) => `${((1 - y) * 100).toFixed(3)}%`;
const _py = (x) => `${(x * 100).toFixed(3)}%`;

// ── the roster ──────────────────────────────────────────────────────────────────
// Five skaters a side, in the positions a viewer expects to be able to name. `lane`
// is where the man lives across the sheet; `depth` is how far ahead of (or behind)
// the puck he plays, signed along his OWN attacking direction — so the identical
// table describes a forechecking winger and a back-checking one, and the defence
// ends up between the puck and its own net without that ever being stated.
const ROLES = [
  { pos: 'C',  lane: 0.50, withPuck:  0.030, without: -0.030, grip: 0.55 },
  { pos: 'LW', lane: 0.24, withPuck:  0.095, without:  0.010, grip: 0.42 },
  { pos: 'RW', lane: 0.76, withPuck:  0.095, without:  0.010, grip: 0.42 },
  { pos: 'LD', lane: 0.33, withPuck: -0.120, without: -0.165, grip: 0.30 },
  { pos: 'RD', lane: 0.67, withPuck: -0.120, without: -0.165, grip: 0.30 },
];

// Motion budget. A broadcast line holds ~10s on air, so the whole possession has to
// resolve well inside that and still leave the outcome on screen to be read.
const T_STEP = 340;          // between possession keyframes
const T_SHOT = 190;          // the shot itself — fast, it's the only quick thing
const T_SETTLE = 620;        // the beat after the puck stops before the caption lands
const T_DRAW = 520;          // faceoff: centres in, puck down, swept back

// How hard each token resists being teleported. A skater carries momentum; the puck
// does not, because a pass IS an instantaneous change of direction and smoothing it
// turns every pass into a lazy curve.
const TAU_SKATER = 230;      // ms to close ~63% of the gap to his target
const TAU_CARRIER = 120;     // the man with it reacts faster — he's chasing nothing
const TAU_CAM = 260;         // camera lag; enough to feel operated rather than welded

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A tiny deterministic generator, so two viewers watching the same broadcast see the
// same men in the same places. Everything cosmetic is seeded off the payload; nothing
// here is ever asked a question whose answer matters.
function _rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function _hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ── the goalie ──────────────────────────────────────────────────────────────────
// Drawn facing the shooter (the group is flipped for the other end). Every piece is a
// named element so the save animations can move exactly one of them: a glove save that
// also swings the blocker is a goalie having a seizure, not making a save.
//
// Viewbox is 40×48, origin at his skates; he's placed by his centre and scaled by CSS
// so the same markup serves both ends and any panel size.
function _goalieSvg() {
  return (
    `<svg class="gdr-g-svg" viewBox="0 0 40 48" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      `<g class="gdr-g-body">` +
        // pads — the two big rectangles that splay in the butterfly
        `<g class="gdr-g-pad left"><rect x="7" y="22" width="9" height="22" rx="3"/>` +
          `<line class="gdr-g-pad-strap" x1="7.8" y1="28" x2="15.2" y2="28"/>` +
          `<line class="gdr-g-pad-strap" x1="7.8" y1="35" x2="15.2" y2="35"/></g>` +
        `<g class="gdr-g-pad right"><rect x="24" y="22" width="9" height="22" rx="3"/>` +
          `<line class="gdr-g-pad-strap" x1="24.8" y1="28" x2="32.2" y2="28"/>` +
          `<line class="gdr-g-pad-strap" x1="24.8" y1="35" x2="32.2" y2="35"/></g>` +
        // chest & arm protector
        `<path class="gdr-g-chest" d="M12 12 h16 a4 4 0 0 1 4 4 v10 a3 3 0 0 1-3 3 h-18 a3 3 0 0 1-3-3 v-10 a4 4 0 0 1 4-4 z"/>` +
        // blocker (stick side) and the stick itself
        `<g class="gdr-g-blocker"><rect x="29" y="14" width="8" height="11" rx="1.5"/></g>` +
        `<g class="gdr-g-stick"><path d="M31 24 L31 41 L20 44" /></g>` +
        // trapper — the one that closes
        `<g class="gdr-g-glove"><path d="M3 15 q-2 5 1 9 q3 4 7 2 q2-1 1-4 l-2-7 z"/>` +
          `<path class="gdr-g-glove-web" d="M4 17 q3 3 5 7"/></g>` +
        // mask & cage
        `<g class="gdr-g-head"><ellipse cx="20" cy="8" rx="6.5" ry="7"/>` +
          `<path class="gdr-g-cage" d="M15 8 h10 M16 5 h8 M16 11 h8 M20 2 v12"/></g>` +
      `</g>` +
    `</svg>`
  );
}

// ── the skater ──────────────────────────────────────────────────────────────────
// A man, not a dot. At the zoom this view now runs at there is room for a body, a
// helmet and a stick, and the stick is the load-bearing part: it's what makes the
// direction he's facing readable, which is what makes a forecheck look like a
// forecheck. The whole figure rotates to his heading; the number tag doesn't, because
// an upside-down number is unreadable and a sweater number is the one thing on the ice
// a broadcast viewer is actually trying to read.
function _skaterSvg() {
  return (
    `<svg class="gdr-sk-svg" viewBox="-12 -14 24 28" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      `<g class="gdr-sk-body">` +
        `<path class="gdr-sk-stick" d="M4.5 1 L9 9 L4 11.5"/>` +
        `<ellipse class="gdr-sk-torso" cx="0" cy="1.5" rx="5.2" ry="6.6"/>` +
        `<path class="gdr-sk-arm left"  d="M-4.6 -0.5 L-7.4 4"/>` +
        `<path class="gdr-sk-arm right" d="M 4.6 -0.5 L 7.4 4"/>` +
        `<circle class="gdr-sk-helm" cx="0" cy="-4.2" r="3.5"/>` +
      `</g>` +
    `</svg>`
  );
}

// ── the net ─────────────────────────────────────────────────────────────────────
// A cage with depth, drawn behind the goal line so the puck can be INSIDE it. The mesh
// is a real grid element so it can bulge: a goal scales the mesh outward from the line
// and snaps it back, which is the single most recognisable image in the sport.
//
// `side` −1 = the away end (the TOP of the picture), +1 = the home end (the bottom).
function _netSvg(side) {
  const gl = side < 0 ? GEO.goalLine[0] : GEO.goalLine[1];
  const back = side < 0 ? GEO.cageBack[0] : GEO.cageBack[1];
  const y0 = Math.min(_sy(gl), _sy(back)), y1 = Math.max(_sy(gl), _sy(back));
  // The mouth spans the sheet's width, so it's an x-range once the picture stands up.
  const x0 = _sx(0.5 + GEO.netHalf), x1 = _sx(0.5 - GEO.netHalf);
  const w = x1 - x0, h = y1 - y0;
  let mesh = '';
  // Mesh lines are drawn per-cage rather than as a <pattern> so the bulge transform
  // has something local to scale — a pattern fill can't deform.
  for (let i = 1; i < 4; i++) { const y = y0 + (h * i / 4); mesh += `<line x1="${x0.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y.toFixed(2)}"/>`; }
  for (let i = 1; i < 7; i++) { const x = x0 + (w * i / 7); mesh += `<line x1="${x.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y1.toFixed(2)}"/>`; }
  const lineY = _sy(gl), backY = _sy(back);
  return (
    `<g class="gdr-net" data-side="${side < 0 ? 'l' : 'r'}">` +
      `<g class="gdr-net-mesh">${mesh}</g>` +
      // the cage frame: the back bar and the two side bars, open toward the ice
      `<path class="gdr-net-frame" d="M${x0.toFixed(2)} ${lineY.toFixed(2)} L${x0.toFixed(2)} ${backY.toFixed(2)} L${x1.toFixed(2)} ${backY.toFixed(2)} L${x1.toFixed(2)} ${lineY.toFixed(2)}"/>` +
      // The two posts, drawn ON the goal line — the puck is only in when it's past
      // the plane they define, so they're the reference the crossing is read against.
      `<circle class="gdr-net-post-cap" cx="${x0.toFixed(2)}" cy="${lineY.toFixed(2)}" r="1.5"/>` +
      `<circle class="gdr-net-post-cap" cx="${x1.toFixed(2)}" cy="${lineY.toFixed(2)}" r="1.5"/>` +
      `<g class="gdr-net-lamp"><circle cx="${(SHEET_W / 2).toFixed(2)}" cy="${(side < 0 ? backY - 4 : backY + 4).toFixed(2)}" r="2.4"/></g>` +
    `</g>`
  );
}

// Static rink markings, drawn at the sheet's real proportions. Pure — built once per
// beat and never touched again, so all the per-frame work is transform-only.
function _rinkSvg() {
  const [glL, glR] = GEO.goalLine, [blL, blR] = GEO.blue;
  const R_CIRCLE = 15;   // 15ft radius on an 85ft sheet — the real one
  const dots = Object.entries(DOTS).map(([id, [x, y]]) => {
    const cx = _sx(y).toFixed(2), cy = _sy(x).toFixed(2);
    const ring = (id === 'C' || /Z/.test(id)) ? `<circle class="gdr-dot-ring" cx="${cx}" cy="${cy}" r="${R_CIRCLE}"/>` : '';
    return `<g class="gdr-dot ${id === 'C' ? 'centre' : /Z/.test(id) ? 'zone' : 'neutral'}" data-dot="${id}">` +
      ring + `<circle class="gdr-dot-spot" cx="${cx}" cy="${cy}" r="1.8"/></g>`;
  }).join('');
  // The crease is a half-disc opening onto the ice, so it's mirrored per end.
  const crease = (side) => {
    const gy = _sy(side < 0 ? glL : glR), r = GEO.creaseR * SHEET_L * 0.5;
    const cx = SHEET_W / 2, half = r * 0.92, d = side < 0 ? 1 : -1;
    return `<path class="gdr-crease" d="M${(cx - half).toFixed(2)} ${gy.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${side < 0 ? 0 : 1} ${(cx + half).toFixed(2)} ${gy.toFixed(2)} Z" data-open="${d}"/>`;
  };
  const across = (cls, x, inset = 0) =>
    `<line class="gdr-line ${cls}" x1="${inset}" y1="${_sy(x).toFixed(2)}" x2="${(SHEET_W - inset).toFixed(2)}" y2="${_sy(x).toFixed(2)}"/>`;
  return (
    `<svg class="gdr-ice" viewBox="0 0 ${SHEET_W} ${SHEET_L}" preserveAspectRatio="none" aria-hidden="true">` +
      `<rect class="gdr-ice-bed" x="0" y="0" width="${SHEET_W}" height="${SHEET_L}" rx="14"/>` +
      // the two attacking zones, a shade colder than the neutral zone
      `<rect class="gdr-zone-att" x="0" y="0" width="${SHEET_W}" height="${_sy(blL).toFixed(2)}"/>` +
      `<rect class="gdr-zone-att" x="0" y="${_sy(blR).toFixed(2)}" width="${SHEET_W}" height="${(SHEET_L - _sy(blR)).toFixed(2)}"/>` +
      crease(-1) + crease(1) +
      across('goal', glL, 6) + across('goal', glR, 6) +
      across('blue', blL) + across('blue', blR) +
      across('red', GEO.centre) +
      dots +
      _netSvg(-1) + _netSvg(1) +
      `<rect class="gdr-boards" x="0.7" y="0.7" width="${(SHEET_W - 1.4).toFixed(2)}" height="${(SHEET_L - 1.4).toFixed(2)}" rx="14"/>` +
    `</svg>`
  );
}

// ── save selection ──────────────────────────────────────────────────────────────
// The sim's chance kind IS the save. This table is the whole mapping, kept in one place
// so a new chance outcome in hockey.js is one line here and not a hunt through the
// animation code.
//   cls      goalie animation class
//   stop     where the puck ends up, as a fraction of the way from the goal line back
//            toward the shooter (0 = on the line, 1 = well out) — negative is INSIDE
//   label    the neutral label (the announcer's line is separate)
const SAVE = {
  save:      { cls: 'chest',  stop: 0.10, label: 'Save' },
  glove:     { cls: 'glove',  stop: 0.06, label: 'Glove Save' },
  pad:       { cls: 'pad',    stop: 0.08, label: 'Pad Save' },
  blocked:   { cls: 'ready',  stop: 0.55, label: 'Blocked' },
  wide:      { cls: 'track',  stop: 0.02, label: 'Wide' },
  post:      { cls: 'beat',   stop: 0.03, label: 'Off the Post' },
  breakaway: { cls: 'poke',   stop: 0.12, label: 'Breakaway Stopped' },
  goal:      { cls: 'beaten', stop: -1,   label: 'GOAL' },
};

export function createRinkView(host) {
  let timers = [];
  let rink = null;              // the clipping viewport
  let cam = null;               // the sliding surface the sheet and tokens live on
  let sheet = null;             // the ice itself — tokens are positioned against THIS
  let caption = '';
  let pendingCaption = null;
  let pendingCard = null;
  let playAnimating = false;
  let cardTimer = null;
  let last = null;              // last payload, for the shell's header/strip

  // ── the live state ────────────────────────────────────────────────────────────
  // Everything the rAF loop integrates. `men` is ten skaters; `puck` is the disc; the
  // camera is a single scalar because it only ever tracks along the sheet.
  let raf = 0;
  let lastFrame = 0;
  let men = [];
  let puckState = { x: 0.5, y: 0.5, hx: 0, hy: 0 };
  let camY = 0.5;               // where along the sheet the camera is centred
  let attackDir = 1;            // +1 = the side with the puck is attacking the home end
  let carrier = null;           // { side, i } or null — whoever is carrying
  let flow = null;              // the puck's current segment
  let flowRng = _rng(1);
  let clockOff = 0;             // ms, for the per-man wander phases

  function _stop() {
    timers.forEach(clearTimeout); timers = [];
    playAnimating = false; pendingCard = null;
  }
  function _t(ms, fn) { timers.push(setTimeout(fn, Math.max(0, ms))); }
  function _stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // ── sound ─────────────────────────────────────────────────────────────────────
  // The CPhL soundset (client/shared/hockey-sfx.js) is procedural and preset-addressed,
  // so the rink names the EVENT and the soundset owns what it sounds like. Silent by
  // design if the file or AudioEngine isn't there — the view must never depend on audio
  // to be readable, because most of the audience is reading text.
  const SFX = {
    shot: 'hk-puck-slap', chest: 'hk-check', pad: 'hk-pad-save', glove: 'hk-glove-save',
    post: 'hk-post', wide: 'hk-glass', block: 'hk-stick-hit', poke: 'hk-stick-hit',
    net: 'hk-net', horn: 'hk-goal-horn', periodHorn: 'hk-period-horn',
    drop: 'hk-puck-tick', sweep: 'hk-skate-scrape', whistle: 'hk-whistle',
    punch: 'hk-punch', punchMiss: 'hk-punch-miss', gloves: 'hk-gloves-drop',
    roar: 'hk-crowd-roar', gasp: 'hk-crowd-gasp', groan: 'hk-crowd-groan',
  };
  // Resolve through the CATALOG, not the bank, so a preset retuned in the dev panel
  // (or overridden in `interface_sfx`) is what actually plays — then hand it to the
  // bank's `variant()` so repeated punches and saves still aren't identical takes.
  // Falls back to the bank alone, then to silence; the view never depends on audio.
  function _sfx(key, seed) {
    const id = SFX[key];
    if (!id) return;
    const def = window.SFXCatalog?.get?.(id);
    if (def && window.HockeySfx?.variant && window.AudioEngine?.playSfx) {
      window.AudioEngine.playSfx(window.HockeySfx.variant(def, seed == null ? _hash(key) : seed));
      return;
    }
    if (def && window.AudioEngine?.playSfx) { window.AudioEngine.playSfx(def); return; }
    window.HockeySfx?.play?.(id, seed);
  }
  // Crowd reactions ride slightly behind the event they're reacting to — a crowd that
  // roars on the same frame as the goal sounds like a laugh track.
  function _crowd(key, delay) { _t(delay == null ? 220 : delay, () => _sfx(key)); }

  const q = (sel) => rink && rink.querySelector(sel);
  const puckEl = () => q('.gdr-puck');
  const goalieEl = (side) => q(`.gdr-goalie[data-side="${side}"]`);

  // ── the rAF loop ──────────────────────────────────────────────────────────────
  // The single owner of every token's position. Nothing else writes `left`/`top` on a
  // skater: a CSS transition and an integrator fighting over the same element is how
  // you get men sliding to places nobody sent them.
  function _startLoop() {
    _stopLoop();
    lastFrame = 0;
    raf = requestAnimationFrame(_frame);
  }

  function _frame(now) {
    raf = requestAnimationFrame(_frame);
    if (!sheet || !sheet.isConnected) return;
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    clockOff += dt;

    _advancePuck(now, dt);
    _advanceMen(dt);
    _advanceCamera(dt);
  }

  // The puck follows whatever segment is current — a beat's keyframe, a shot, or a
  // stretch of idle circulation. `flow` is always populated; the ice is never dead.
  function _advancePuck(now, dt) {
    if (!flow) { _nextIdleFlow(); }
    const f = flow;
    const t = clamp((now - f.t0) / Math.max(1, f.ms), 0, 1);
    const e = f.ease === 'in' ? t * t : f.ease === 'out' ? 1 - (1 - t) * (1 - t) : t * t * (3 - 2 * t);
    const nx = f.x0 + (f.x1 - f.x0) * e;
    const ny = f.y0 + (f.y1 - f.y0) * e;
    puckState.hx = nx - puckState.x; puckState.hy = ny - puckState.y;
    puckState.x = nx; puckState.y = ny;
    _writeToken(puckEl(), nx, ny);
    if (t >= 1) {
      if (f.onEnd) { const fn = f.onEnd; f.onEnd = null; fn(); }
      // A beat's chain schedules its own next segment; only the idle flow refills
      // itself, which is what stops idle motion from stepping on a live play.
      if (flow === f && f.idle) _nextIdleFlow();
      else if (flow === f && f.thenIdle) _nextIdleFlow();
    }
  }

  // Formation. Every man targets a point derived from the puck and his role, so the
  // whole team shifts as one when the puck moves — which is the thing that reads as
  // hockey rather than ten independent wanderers.
  function _advanceMen(dt) {
    const px = puckState.x, py = puckState.y;
    for (const m of men) {
      const role = ROLES[m.i];
      const d = m.dir;                                  // his own attacking direction
      const has = carrier && carrier.side === m.side;   // his side has the puck
      const isCarrier = carrier && carrier.side === m.side && carrier.i === m.i;

      let tx, ty;
      if (m.pin) {
        // Held: locked up in a fight, pinned on the boards, or lying where he fell.
        // Nothing about the puck moves him until whatever is holding him lets go.
        [tx, ty] = m.pin;
      } else if (isCarrier) {
        // He IS the puck, near enough — a stride behind it, on his own attacking side.
        tx = px - d * 0.012; ty = py;
      } else {
        tx = px + d * (has ? role.withPuck : role.without);
        // `grip` is how strongly he follows the puck across the sheet. A centre shades
        // over hard; a defenceman holds his lane, which is what keeps the pair spread
        // across the front of their own net instead of both chasing the same corner.
        ty = role.lane + (py - 0.5) * role.grip;
        // Nobody stands still. Small, slow, out of phase per man — enough that the ice
        // looks occupied between beats without anybody appearing to have somewhere to be.
        tx += Math.sin((clockOff + m.phase) / 1450) * 0.014;
        ty += Math.cos((clockOff + m.phase * 1.7) / 1180) * 0.022;
      }
      // Inside the boards, and out of the goalie's paint.
      tx = clamp(tx, 0.035, 0.965); ty = clamp(ty, 0.06, 0.94);

      const tau = isCarrier ? TAU_CARRIER : TAU_SKATER;
      const k = 1 - Math.exp(-dt / tau);
      const nx = m.x + (tx - m.x) * k, ny = m.y + (ty - m.y) * k;
      const vx = nx - m.x, vy = ny - m.y;
      m.x = nx; m.y = ny;
      // Heading, low-passed — a man who snaps to face every jitter looks like a compass
      // needle. Below a threshold he keeps the heading he had rather than spinning.
      //
      // The figure is drawn facing UP, so 0 is up and the angle is taken in SCREEN
      // deltas: across the sheet is negated (model y runs the other way once the
      // picture stands up) and each axis is weighted by the sheet's real proportions,
      // or a man crossing the narrow axis appears to turn twice as far as he did.
      const sp = Math.hypot(vx, vy);
      if (sp > 0.00025) {
        const want = Math.atan2(-vy * SHEET_W, -vx * SHEET_L);
        let da = want - m.head;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        m.head += da * Math.min(1, dt / 120);
      }
      m.speed += (sp * 1000 - m.speed) * Math.min(1, dt / 200);
      _writeSkater(m);
    }
  }

  // The camera. It tracks the puck along the sheet with a lead in the direction of
  // travel — an operator anticipates, and a camera that only ever centres what already
  // happened feels a half-second behind the play the whole night.
  function _advanceCamera(dt) {
    const lead = clamp(puckState.hx * 14, -0.09, 0.09);
    const want = clamp01(puckState.x + lead);
    camY += (want - camY) * (1 - Math.exp(-dt / TAU_CAM));
    if (!cam || !rink) return;
    const ch = cam.offsetHeight, vh = rink.clientHeight;
    if (!ch || !vh) return;
    // Never show past the end of the sheet: at the ends the camera stops and the puck
    // travels within the frame, which is exactly what a real one does behind the net.
    const maxOff = Math.max(0, ch - vh);
    const off = clamp(camY * ch - vh / 2, 0, maxOff);
    cam.style.transform = `translate3d(0, ${-off.toFixed(1)}px, 0)`;
  }

  function _writeToken(el, x, y) {
    if (!el) return;
    el.style.left = _px(y); el.style.top = _py(x);
  }
  function _writeSkater(m) {
    if (!m.el) return;
    m.el.style.left = _px(m.y); m.el.style.top = _py(m.x);
    if (m.svg) m.svg.style.transform = `rotate(${(m.head * 180 / Math.PI).toFixed(1)}deg)`;
    const fast = m.speed > 0.16;
    if (fast !== m.wasFast) { m.el.classList.toggle('striding', fast); m.wasFast = fast; }
    const isCarrier = carrier && carrier.side === m.side && carrier.i === m.i;
    if (isCarrier !== m.wasCarrier) { m.el.classList.toggle('carrier', isCarrier); m.wasCarrier = isCarrier; }
  }

  // ── the puck's segments ───────────────────────────────────────────────────────
  function _segment(x1, y1, ms, opts) {
    flow = {
      x0: puckState.x, y0: puckState.y, x1: clamp01(x1), y1: clamp01(y1),
      ms: Math.max(16, ms), t0: performance.now(), ease: (opts && opts.ease) || 'smooth',
      onEnd: (opts && opts.onEnd) || null, idle: !!(opts && opts.idle), thenIdle: !!(opts && opts.thenIdle),
    };
    return flow;
  }

  // Idle circulation. Between beats the puck keeps moving the way a puck does when
  // nothing is happening: a D-to-D across the point, a wall play, a dump-in, a
  // retrieval behind the net. It resolves NOTHING — no shot ever comes out of here,
  // because the only shots that exist are the ones the sim decided.
  const IDLE = [
    { dx: -0.10, y: 0.18, ms: 900 },    // out to the wall
    { dx: -0.02, y: 0.82, ms: 1100 },   // D-to-D across
    { dx:  0.16, y: 0.72, ms: 1000 },   // up the far wing
    { dx:  0.10, y: 0.50, ms: 850 },    // into the middle
    { dx: -0.14, y: 0.30, ms: 1050 },   // turned back
    { dx:  0.22, y: 0.24, ms: 1200 },   // carried up the near wall
  ];
  function _nextIdleFlow() {
    const step = IDLE[(flowRng() * IDLE.length) | 0];
    const jitter = (flowRng() - 0.5) * 0.10;
    let nx = puckState.x + attackDir * step.dx + jitter;
    let ny = step.y + (flowRng() - 0.5) * 0.12;
    // Keep the idle puck off the goal lines entirely. A puck drifting into the crease
    // between beats would look like a chance that nobody called, and the announcer's
    // silence would be the tell.
    nx = clamp(nx, GEO.blue[0] * 0.45, 1 - (1 - GEO.blue[1]) * 0.45);
    // A change of possession, purely for the picture: the carrier flips sides now and
    // then so both sweaters get the puck between whistles.
    if (flowRng() < 0.22) {
      const side = flowRng() < 0.5 ? 'a' : 'h';
      carrier = { side, i: 1 + ((flowRng() * 4) | 0) };
      attackDir = side === 'a' ? 1 : -1;
    }
    _segment(nx, ny, step.ms * (0.8 + flowRng() * 0.5), { idle: true });
  }

  // ── the goalie ────────────────────────────────────────────────────────────────
  // He is never idle. Between shots he shuffles across his crease to stay square to
  // the puck — the depth of a goalie's game is lateral, and a still goalie reads as a
  // dead sprite. Driven off the loop rather than the beat, so he tracks the idle puck
  // as attentively as a live one.
  function _goalieTrack(side, puckY, ms) {
    const g = goalieEl(side); if (!g) return;
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    // He plays out from the line a little, and covers only a fraction of the lateral
    // spread — overselling this makes him look like he's on rails.
    const depth = side === 'l' ? gl + 0.020 : gl - 0.020;
    const y = 0.5 + (clamp01(puckY) - 0.5) * 0.42;
    g.style.transition = ms ? `left ${ms}ms cubic-bezier(.4,0,.3,1), top ${ms}ms cubic-bezier(.4,0,.3,1)` : 'none';
    _writeToken(g, depth, y);
  }
  function _goaliePose(side, cls, holdMs) {
    const g = goalieEl(side); if (!g) return;
    g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-${cls}`;
    g.dataset.side = side;
    if (holdMs) _t(holdMs, () => { if (g.isConnected) g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-ready`; });
  }
  // Both goalies re-square themselves on a slow cadence off the live puck.
  function _goalieIdlePulse() {
    if (!sheet || !sheet.isConnected) return;
    _goalieTrack('l', puckState.y, 620);
    _goalieTrack('r', puckState.y, 620);
    _t(560, _goalieIdlePulse);
  }

  // ── the net ───────────────────────────────────────────────────────────────────
  // The mesh bulge. Fired the instant the puck reaches the back of the cage — not when
  // the goal is announced — so the picture and the physics agree.
  function _bulge(side) {
    const mesh = q(`.gdr-net[data-side="${side}"] .gdr-net-mesh`);
    if (mesh) { mesh.classList.remove('bulge'); void mesh.getBoundingClientRect(); mesh.classList.add('bulge'); _t(900, () => mesh.classList.remove('bulge')); }
    const net = q(`.gdr-net[data-side="${side}"]`);
    if (net) { net.classList.add('scored'); _t(2600, () => net.classList.remove('scored')); }
  }
  function _clang(side) {
    const net = q(`.gdr-net[data-side="${side}"]`);
    if (net) { net.classList.remove('rang'); void net.getBoundingClientRect(); net.classList.add('rang'); _t(700, () => net.classList.remove('rang')); }
  }

  // Short-lived effect token (spray, ring, whistle) at model coords.
  function _spawn(cls, x, y, life) {
    const layer = q('.gdr-fx'); if (!layer) return null;
    const el = document.createElement('div');
    el.className = cls; el.style.left = _px(y); el.style.top = _py(x);
    layer.appendChild(el); _t(life, () => el.remove());
    return el;
  }

  // ── shell ─────────────────────────────────────────────────────────────────────
  // Sweaters and numbers. The colours ride the payload (the sim derives them from the
  // club name), so both sides wear their own and the view holds no palette that could
  // drift from the league's. Numbers are seeded off the club name, so a club's 14 is
  // its 14 every night without a roster ever crossing the wire for a cosmetic.
  function _numbersFor(team) {
    const r = _rng(_hash(team || 'cphl'));
    const out = [], seen = new Set();
    while (out.length < 5) {
      const n = 2 + ((r() * 96) | 0);
      if (seen.has(n)) continue;
      seen.add(n); out.push(n);
    }
    return out;
  }

  function _skaterMarkup(side, colours, team) {
    const style = colours ? `--gdr-jersey:${colours[0]};--gdr-trim:${colours[1]};` : '';
    const nums = _numbersFor(team);
    return ROLES.map((role, i) =>
      `<div class="gdr-skater ${side === 'a' ? 'att' : 'def'}${colours ? ' clubbed' : ''}" data-side="${side}" data-i="${i}" style="${style}">` +
        _skaterSvg() +
        `<span class="gdr-sk-tag">${nums[i]}${role.pos}</span>` +
      `</div>`).join('');
  }

  // `attackedNet` is the end being shot at this beat: 'r' = the home end (bottom of the
  // picture). The attackers break out of the OTHER end — without this the formation and
  // the rush run in opposite directions on a home-team chance, which reads as the wrong
  // team attacking.
  function _shell(p, attackedNet) {
    const awayTeam = p.awayTeam || p.awayAbbr || 'away';
    const homeTeam = p.homeTeam || p.homeAbbr || 'home';
    return (
      `<div class="gdr-wrap">` +
        `<div class="gdr-head">` +
          `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
          `<span class="gdr-head-score">${_esc(p.awayAbbr || p.awayTeam || 'AWY')} <b>${p.awayScore | 0}</b> — <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || p.homeTeam || 'HOM')}</span>` +
          `<span class="gdr-head-clock">${_esc(p.section || '')} ${_esc(p.clock || '')}</span>` +
          (p.rivalry ? '<span class="gdr-head-rival">RIVALRY</span>' : '') +
          (p.strength && p.strength !== 'even' ? `<span class="gdr-head-str ${_esc(p.strength)}">${_esc(p.strength.toUpperCase())}</span>` : '') +
        `</div>` +
        // The viewport clips; the cam slides; the sheet is the coordinate space every
        // token is positioned in. Three elements, three jobs, and the tokens never need
        // to know the camera exists.
        `<div class="gdr-rink">` +
          `<div class="gdr-cam">` +
            `<div class="gdr-stands" aria-hidden="true"></div>` +
            `<div class="gdr-sheet">` +
              _rinkSvg() +
              `<div class="gdr-fx"></div>` +
              `<div class="gdr-skaters">` +
                _skaterMarkup('a', p.awayColours || p.attackingColours, awayTeam) +
                _skaterMarkup('h', p.homeColours || p.defendingColours, homeTeam) +
              `</div>` +
              `<div class="gdr-goalie left pose-ready" data-side="l">${_goalieSvg()}</div>` +
              `<div class="gdr-goalie right pose-ready" data-side="r">${_goalieSvg()}</div>` +
              `<div class="gdr-puck"></div>` +
            `</div>` +
          `</div>` +
          `<div class="gdr-vignette" aria-hidden="true"></div>` +
        `</div>` +
        `<div class="gdr-strip">` +
          `<span class="gdr-strip-desc">${_esc(p.desc || '')}</span>` +
          `<span class="gdr-strip-names">${_esc(p.shooter || '')}${p.assist ? ` · assist ${_esc(p.assist)}` : ''}${p.goalie ? ` · vs ${_esc(p.goalie)}` : ''}</span>` +
        `</div>` +
        `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
      `</div>`
    );
  }

  // Which end is being attacked. The sim's keyframes run toward whichever net the
  // attacking side is shooting at; the last keyframe's x is the honest answer, so we
  // read it rather than trusting a flag that could disagree with the picture. With no
  // keyframes (a faceoff, a fight) nobody is attacking and the default just fixes the
  // away side attacking the home end, which is the frame `winnerSide` is computed in.
  function _attackSide(nodes) {
    if (!nodes || !nodes.length) return 'r';
    return nodes[nodes.length - 1].p[0] >= 0.5 ? 'r' : 'l';
  }

  // Bind the ten DOM skaters to the ten integrated men, and seed them into a legible
  // formation so the first frame is a hockey team rather than a pile at centre ice.
  function _bindMen(p, attackedNet) {
    men = [];
    const seed = _hash(`${p.awayTeam || ''}|${p.homeTeam || ''}|${p.clock || ''}`);
    const r = _rng(seed);
    for (const side of ['a', 'h']) {
      // The side attacking `attackedNet` moves toward it; the other defends it.
      const attacksHomeEnd = (side === 'a') === (attackedNet === 'r');
      const dir = attacksHomeEnd ? 1 : -1;
      for (let i = 0; i < ROLES.length; i++) {
        const el = sheet.querySelector(`.gdr-skater[data-side="${side}"][data-i="${i}"]`);
        const role = ROLES[i];
        const m = {
          side, i, el, dir, role,
          svg: el ? el.querySelector('.gdr-sk-svg') : null,
          x: clamp01(0.5 - dir * (0.10 + i * 0.03)), y: role.lane,
          // Facing the way he attacks: the home end is the BOTTOM of the picture.
          head: dir > 0 ? Math.PI : 0,
          speed: 0, phase: r() * 6000, wasFast: false, wasCarrier: false, pin: null,
        };
        men.push(m);
        _writeSkater(m);
      }
    }
  }

  // ── the possession ────────────────────────────────────────────────────────────
  function _playPossession(p) {
    const nodes = Array.isArray(p.possession) ? p.possession.slice() : [];
    if (!nodes.length) { _resolveNoPuck(p); return; }
    const side = _attackSide(nodes);
    const kind = p.kind === 'goal' || p.type === 'goal' ? 'goal' : (p.kind || 'save');
    const save = SAVE[kind] || SAVE.save;

    playAnimating = true;
    // The attacking side is the one whose men should be ahead of the puck. `side` is
    // the end under siege, so whoever attacks it is the side with it.
    const attSide = side === 'r' ? 'a' : 'h';
    attackDir = side === 'r' ? 1 : -1;
    carrier = { side: attSide, i: 0 };
    for (const m of men) m.dir = (m.side === attSide) ? attackDir : -attackDir;

    puckState.x = nodes[0].p[0]; puckState.y = nodes[0].p[1];
    _writeToken(puckEl(), puckState.x, puckState.y);
    _goaliePose(side, 'ready');

    // Chain the keyframes: each segment's end schedules the next, so the whole rush is
    // one continuous motion rather than a queue of timers that can drift apart.
    let idx = 1;
    const step = () => {
      if (idx >= nodes.length) return;
      const nd = nodes[idx], prev = nodes[idx - 1];
      const shot = nd.ev === 'shot';
      idx++;
      if (nd.carrier >= 0) carrier = { side: attSide, i: Math.max(0, nd.carrier | 0) % ROLES.length };
      if (nd.ev === 'entry') _flashLine(side);
      if (nd.ev === 'pass') { _passTrail(prev.p, nd.p, T_STEP); carrier = null; }
      if (shot) { _sfx('shot'); _windUp(attSide, carrier ? carrier.i : 0); carrier = null; }
      _segment(nd.p[0], nd.p[1], T_STEP, {
        ease: shot ? 'in' : 'smooth',
        onEnd: () => {
          // Whoever it was passed to picks it up on arrival — the carrier is the man
          // the puck REACHED, which is the only reading that survives a deflection.
          if (nd.ev === 'pass' && nd.carrier >= 0) carrier = { side: attSide, i: Math.max(0, nd.carrier | 0) % ROLES.length };
          if (idx < nodes.length) step();
          else _resolveShot(p, kind, save, side, nodes[nodes.length - 1]);
        },
      });
    };
    step();
  }

  // A puck that never got shot (a faceoff, a fight, a whistle) still needs the rink to
  // do something honest, so those beats get their own short pieces below.
  function _resolveNoPuck(p) {
    playAnimating = true;
    if (p.type === 'faceoff') _playFaceoff(p);
    else if (p.type === 'fight') _playFight(p);
    else if (p.type === 'boards') _playHit(p);
    else if (p.type === 'injury') _playInjury(p);
    else if (p.type === 'death') _playDeath(p);
    else if (p.type === 'scrum') _playScrum(p);
    _t(T_DRAW + T_SETTLE, () => _reveal(p));
  }

  // ── the violence ──────────────────────────────────────────────────────────────
  // The CPhL is a league where men are carried off and sometimes killed, and the ice
  // used to sit perfectly still through every one of those calls — the announcer
  // describing a body going through the glass over a photograph of five men standing
  // in a diamond. Every violent beat the sim emits now happens ON the ice.
  //
  // The server names the sides in its own att/def frame ('att' is always the away
  // club), so the client never has to know a club name to work out who ate it.
  const _sideOf = (tag, fallback) => (tag === 'def' ? 'h' : tag === 'att' ? 'a' : fallback);
  // Pick a man deterministically from a name, so the same hit puts the same sweater on
  // the boards for everybody watching — and so a defenceman doesn't get hit as the
  // centre on one screen and as a winger on the next.
  function _manFor(side, name, bias) {
    const i = name ? (_hash(name) % ROLES.length) : ((bias | 0) % ROLES.length);
    return men.find(m => m.side === side && m.i === i) || men.find(m => m.side === side);
  }
  // The nearest wall to a point — a hit finishes at the boards, and which boards is
  // simply whichever ones were closer.
  const _nearBoards = (y) => (y < 0.5 ? 0.075 : 0.925);

  function _down(m, cls) {
    if (!m || !m.el) return;
    m.pin = [m.x, m.y];
    m.el.classList.add(cls || 'down');
  }
  function _up(m) {
    if (!m || !m.el) return;
    m.pin = null;
    m.el.classList.remove('down', 'dead', 'shoving');
  }

  // A hit. The hitter closes, the victim goes into the wall, the boards take it. The
  // impact is the frame everything else is timed off — the spray, the sound and the
  // building's reaction all hang behind it, because a crowd that reacts on the same
  // frame as the collision sounds like it was expecting it.
  function _playHit(p) {
    const vSide = _sideOf(p.victimSide, 'h');
    const hSide = _sideOf(p.hitterSide, vSide === 'a' ? 'h' : 'a');
    const victim = _manFor(vSide, p.victim, 1);
    const hitter = _manFor(hSide, p.hitter, 4);
    if (!victim || !hitter) return;
    const wall = _nearBoards(puckState.y);
    const hx = clamp(puckState.x, 0.12, 0.88);
    // Both men converge on the wall, the hitter arriving from the inside.
    victim.pin = [hx, wall];
    hitter.pin = [hx, wall + (wall < 0.5 ? 0.055 : -0.055)];
    _t(300, () => {
      hitter.pin = [hx, wall + (wall < 0.5 ? 0.028 : -0.028)];
      hitter.el?.classList.add('swing');
    });
    _t(430, () => {
      _sfx('chest');
      _spawn('gdr-hit', hx, wall, 420);
      _boardsShake();
      victim.el?.classList.add('hit');
      _down(victim);
      _crowd('roar', 150);
      _t(150, () => victim.el?.classList.remove('hit'));
      _t(140, () => hitter.el?.classList.remove('swing'));
    });
    // He gets up — unless the sim follows this beat with an injury, which arrives as
    // its own beat and re-pins him. Play never stopped, so the puck keeps circulating.
    _t(1900, () => { _up(victim); hitter.pin = null; });
  }

  // He isn't getting up. The man is helped off toward the near boards and out of the
  // picture, which is the whole visible consequence of an injury: his club is now
  // playing a man short, and the empty lane is how you see it.
  function _playInjury(p) {
    const vSide = _sideOf(p.victimSide, 'h');
    const victim = _manFor(vSide, p.victim, 1);
    if (!victim) return;
    _down(victim);
    _sfx('whistle');
    _crowd('groan', 320);
    _spawn('gdr-whistle', victim.x, victim.y, 900);
    _t(1200, () => {
      // Off toward the boards, and gone.
      victim.pin = [victim.x, _nearBoards(victim.y)];
      victim.el?.classList.add('leaving');
    });
    // Play is dead until the drop, so the puck stops where it lies.
    _segment(puckState.x, puckState.y, 3200, { thenIdle: true });
  }

  // The one the league is famous for. Everybody stops. The rink itself goes cold, the
  // other nine men drift into a ring around him and stay there, and nothing moves
  // again until the next beat — which is the only time this view is deliberately
  // still, and the stillness is the point.
  function _playDeath(p) {
    const vSide = _sideOf(p.victimSide, 'h');
    const victim = _manFor(vSide, p.victim, 1);
    if (!victim) return;
    _down(victim, 'dead');
    victim.el?.classList.add('down');
    _spawn('gdr-blood', victim.x, victim.y, 9000);
    rink?.classList.add('mourning');
    _sfx('whistle');
    _crowd('groan', 500);
    // The ring. Everyone else closes to a stop around him rather than around the puck.
    const others = men.filter(m => m !== victim);
    others.forEach((m, k) => {
      const a = (k / others.length) * Math.PI * 2;
      m.pin = [clamp(victim.x + Math.cos(a) * 0.055, 0.05, 0.95), clamp(victim.y + Math.sin(a) * 0.13, 0.08, 0.92)];
    });
    _segment(puckState.x, puckState.y, 8000, { thenIdle: true });
  }

  // A scrum. No punches thrown and nobody charged — just a knot of bodies after the
  // whistle, which is a different picture from a fight and has to look like one.
  function _playScrum(p) {
    const knot = men.filter(m => m.i > 0).slice(0, 6);
    const cx = clamp(puckState.x, 0.10, 0.90), cy = clamp(puckState.y, 0.12, 0.88);
    knot.forEach((m, k) => {
      const a = (k / knot.length) * Math.PI * 2;
      m.pin = [cx + Math.cos(a) * 0.022, cy + Math.sin(a) * 0.05];
      m.el?.classList.add('shoving');
    });
    _sfx('gloves');
    _crowd('gasp', 260);
    _t(2600, () => knot.forEach(m => _up(m)));
  }

  // The glass takes it. A cheap cue and the most recognisable one in the building.
  function _boardsShake() {
    const b = q('.gdr-boards');
    if (b) { b.classList.remove('shook'); void b.getBoundingClientRect(); b.classList.add('shook'); _t(600, () => b.classList.remove('shook')); }
    if (rink) { rink.classList.add('jolt'); _t(320, () => rink.classList.remove('jolt')); }
  }

  function _resolveShot(p, kind, save, side, final) {
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    const back = side === 'l' ? GEO.cageBack[0] : GEO.cageBack[1];
    const dir = side === 'l' ? -1 : 1;
    carrier = null;
    _goaliePose(side, save.cls, kind === 'goal' ? 2400 : 1400);

    if (kind === 'goal') {
      // THE ONE THAT MATTERS. The puck travels past the goal line — visibly past, the
      // line is drawn and it crosses it — and only then reaches the mesh, which bulges.
      // Two separate motions, because "crossed the line" and "in the net" are two
      // separate facts and the second is the consequence of the first.
      _segment(gl, final.p[1], T_SHOT, { ease: 'in', onEnd: () => {
        _crossFlash(side);
        _sfx('horn', p.hornSeed);   // every barn's horn is that barn's horn
        _segment(back - dir * 0.006, final.p[1], 150, { ease: 'out', onEnd: () => {
          _bulge(side); _sfx('net'); _spawn('gdr-spray', back - dir * 0.02, final.p[1], 700);
          _t(T_SETTLE, () => { _reveal(p); _nextIdleFlow(); });
        } });
      } });
      _crowd('roar', T_SHOT + 260);
      return;
    }

    // Everything else stops short of the line. `stop` is measured back from the goal
    // line toward the shooter, so a glove save is caught right on the doorstep and a
    // block dies out at the top of the circle.
    const stopX = gl - dir * save.stop * 0.30;
    _segment(stopX, final.p[1], T_SHOT, { ease: 'out', onEnd: () => {
      const rest = (x, y, ms) => _segment(x, y, ms, { ease: 'out', thenIdle: true });
      // Iron. The only non-goal the building reacts to, so it gets the gasp.
      if (kind === 'post') { _clang(side); _sfx('post'); _crowd('gasp'); rest(stopX - dir * 0.06, final.p[1] < 0.5 ? 0.08 : 0.92, 420); }
      else if (kind === 'wide') { _sfx('wide'); rest(gl + dir * 0.03, final.p[1] < 0.5 ? 0.06 : 0.94, 300); }
      else if (kind === 'blocked') { _spawn('gdr-block', stopX, final.p[1], 600); _sfx('block'); rest(stopX - dir * 0.09, final.p[1], 420); }
      else if (kind === 'pad') { _sfx('pad'); rest(stopX - dir * 0.10, final.p[1] < 0.5 ? 0.16 : 0.84, 380); }
      else if (kind === 'glove') { _sfx('glove'); _stickPuckToGlove(side, final.p[1]); }
      else if (kind === 'breakaway') { _sfx('poke'); rest(stopX - dir * 0.07, final.p[1], 320); }
      else {
        // plain save: held on the chest, and if the sim says he froze it, the whistle
        _sfx('chest');
        // He covered it. The whistle is the reason the next beat is a faceoff in this end.
        if (p.frozen) { _spawn('gdr-whistle', stopX, final.p[1], 900); _t(140, () => _sfx('whistle')); _holdPuck(side, final.p[1]); }
        else rest(stopX - dir * 0.05, final.p[1], 340);
      }
      _t(T_SETTLE, () => _reveal(p));
    } });
  }

  // The trapper closes ON the puck: the puck is parked at the glove and hidden, which
  // is the only way a top-down view can say "he caught it" rather than "it stopped".
  function _stickPuckToGlove(side, y) {
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    const dir = side === 'l' ? -1 : 1;
    _segment(gl - dir * 0.018, clamp01(y * 0.5 + 0.25), 120, { ease: 'out', onEnd: () => _holdPuck(side, y) });
  }
  // Play is dead. The puck sits where it was covered until the next beat arrives —
  // which is honest: a frozen puck is the one moment the ice legitimately IS still.
  function _holdPuck(side, y) {
    const pk = puckEl();
    if (pk) { pk.classList.add('caught'); _t(1600, () => pk.classList.remove('caught')); }
    _segment(puckState.x, puckState.y, 1400, { thenIdle: true });
  }

  function _windUp(side, i) {
    const m = men.find(mm => mm.side === side && mm.i === i);
    if (!m || !m.el) return;
    m.el.classList.add('shooting'); _t(420, () => m.el.classList.remove('shooting'));
  }
  function _flashLine(side) {
    const ln = rink && rink.querySelectorAll('.gdr-line.blue')[side === 'l' ? 0 : 1];
    if (ln) { ln.classList.add('lit'); _t(420, () => ln.classList.remove('lit')); }
  }
  function _crossFlash(side) {
    const ln = rink && rink.querySelectorAll('.gdr-line.goal')[side === 'l' ? 0 : 1];
    if (ln) { ln.classList.add('crossed'); _t(900, () => ln.classList.remove('crossed')); }
  }
  function _passTrail(from, to, ms) {
    for (let i = 1; i <= 3; i++) {
      const f = i / 4;
      _t(ms * f * 0.6, () => _spawn('gdr-trail', from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 420));
    }
  }

  // ── faceoff ───────────────────────────────────────────────────────────────────
  // The two centres to the dot the sim named, the puck down between them, and the
  // winner's side sweeps it back. Which dot is the whole story of the stoppage, so the
  // dot itself pulses — the viewer's eye goes to the right end of the ice unprompted.
  function _playFaceoff(p) {
    const [dx, dy] = DOTS[p.dot] || DOTS.C;
    const dot = q(`.gdr-dot[data-dot="${p.dot}"]`);
    if (dot) { dot.classList.add('live'); _t(2200, () => dot.classList.remove('live')); }
    carrier = null;
    // Both centres to the dot; everyone else keeps his lane around it, which the
    // formation already does once the puck is sitting there.
    _segment(dx, dy, T_DRAW * 0.55, { ease: 'out', onEnd: () => {
      _sfx('drop');
      const won = p.winnerSide === 'def' ? -attackDir : attackDir;
      _segment(clamp01(dx - won * 0.10), clamp01(dy + (dy < 0.5 ? 0.05 : -0.05)), 300, { ease: 'out', onEnd: () => {
        _sfx('sweep');
        carrier = { side: p.winnerSide === 'def' ? 'h' : 'a', i: 3 };
      }, thenIdle: true });
    } });
  }

  // ── fight ─────────────────────────────────────────────────────────────────────
  // Played off the sim's own exchange list, so the number of punches, who threw each
  // and which landed are the server's facts, not the client's invention.
  function _playFight(p) {
    const ex = Array.isArray(p.exchange) ? p.exchange.slice(0, 10) : [];
    const a = men.find(m => m.side === 'a' && m.i === 0);
    const d = men.find(m => m.side === 'h' && m.i === 0);
    // The exchange names its thrower by NAME, and the only name we can place on the
    // ice is the winner — the server tells us which side he's on. Everything he didn't
    // throw was thrown by the other man, so two facts resolve the whole exchange.
    const winnerIsAtt = p.winnerSide !== 'def';
    const winMan = p.winner || '';
    carrier = null;
    // The two of them lock up wherever the puck last was — a fight starts where the
    // play was, not at centre ice.
    const fx = puckState.x, fy = puckState.y;
    if (a) { a.pin = [fx, fy - 0.035]; a.el?.classList.add('fighting'); }
    if (d) { d.pin = [fx, fy + 0.035]; d.el?.classList.add('fighting'); }
    _sfx('gloves');
    let at = 380;
    ex.forEach((e) => {
      _t(at, () => {
        const byWinner = e.thrower === winMan;
        const thrower = (byWinner === winnerIsAtt) ? a : d;
        const taker = thrower === a ? d : a;
        thrower?.el?.classList.add('swing'); _t(120, () => thrower?.el?.classList.remove('swing'));
        if (e.landed) { taker?.el?.classList.add('hit'); _t(150, () => taker?.el?.classList.remove('hit')); _spawn('gdr-hit', fx, fy, 300); _sfx('punch'); }
        else _sfx('punchMiss');
      });
      at += 170;
    });
    _t(at + 200, () => {
      a?.el?.classList.remove('fighting'); d?.el?.classList.remove('fighting');
      if (a) a.pin = null; if (d) d.pin = null;
    });
    _segment(fx, fy, at + 400, { thenIdle: true });
  }

  // ── reveal ────────────────────────────────────────────────────────────────────
  function _reveal(p) {
    playAnimating = false;
    if (pendingCaption) { _showCaption(pendingCaption.text); if (pendingCaption.speak) pendingCaption.speak(); pendingCaption = null; }
    if (pendingCard) { _renderCard(pendingCard); pendingCard = null; }
  }

  // ── the intermission board ────────────────────────────────────────────────────
  // Between periods the ice is empty for fifteen minutes and there is no play to
  // animate, so the sub-screen becomes what a real broadcast cuts to: the period
  // summary the announcer is reading, on a board, with the league table beside it.
  function _intermission(p) {
    const goals = Array.isArray(p.goals) ? p.goals : [];
    const rows = goals.length
      ? goals.map(g => `<div class="gdri-goal">` +
          `<span class="t">${_esc(g.clockStr || '')}</span>` +
          `<span class="n">${_esc(g.shooter || '')}</span>` +
          `<span class="a">${g.assist ? `from ${_esc(g.assist)}` : 'unassisted'}</span>` +
          `<span class="c">${_esc(g.teamName || '')}</span>` +
          (g.strength && g.strength !== 'even' ? `<span class="s">${_esc(String(g.strength).toUpperCase())}</span>` : '') +
        `</div>`).join('')
      : `<div class="gdri-none">No goals in the ${_esc(p.section || 'period')}.</div>`;
    const cas = (p.casualties || []).length
      ? `<div class="gdri-cas">Carried off: ${(p.casualties || []).map(_esc).join(', ')} — no replacements.</div>` : '';
    host.innerHTML =
      `<div class="gdr-wrap">` +
        `<div class="gdr-head">` +
          `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
          `<span class="gdr-head-score">${_esc(p.awayAbbr || 'AWY')} <b>${p.awayScore | 0}</b> — <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || 'HOM')}</span>` +
          `<span class="gdr-head-clock">INTERMISSION</span>` +
        `</div>` +
        `<div class="gdri">` +
          `<div class="gdri-main">` +
            `<div class="gdri-title">END OF THE ${_esc((p.section || '').toUpperCase())}</div>` +
            `<div class="gdri-sub">Scoring summary</div>` +
            `<div class="gdri-goals">${rows}</div>` +
            cas +
            `<div class="gdri-stats">` +
              `<span><i>SOG</i> ${_esc(p.awayAbbr || 'AWY')} ${p.shotsAway | 0} · ${_esc(p.homeAbbr || 'HOM')} ${p.shotsHome | 0}</span>` +
              `<span><i>PEN</i> ${p.penalties | 0}</span>` +
              `<span><i>FIGHTS</i> ${p.fights | 0}</span>` +
              `<span><i>HITS</i> ${p.hits | 0}</span>` +
            `</div>` +
            `<div class="gdri-next">Back for the ${_esc(p.nextOrd || 'next period')}</div>` +
          `</div>` +
          _standingsDock(p) +
        `</div>` +
        `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
      `</div>`;
    // No ice on screen — the loop and the beat helpers must not try to move tokens.
    rink = null; cam = null; sheet = null; men = []; _stopLoop();
    _t(T_SETTLE, () => _reveal(p));
  }

  // The league dock. Absent rather than empty before the CPhL has played a game —
  // a table of zeroes says less than no table at all.
  function _standingsDock(p) {
    const rows = Array.isArray(p.standings) ? p.standings.slice(0, 6) : [];
    if (!rows.length) return '';
    const me = (t) => (t === p.awayTeam || t === p.homeTeam) ? ' me' : '';
    return `<div class="gdri-stand">` +
      `<div class="gdri-stand-head">CPhL · PTS</div>` +
      rows.map((r, i) => `<div class="gdri-stand-row${me(r.team)}">` +
        `<span class="r">${i + 1}</span><span class="t">${_esc(r.team)}</span>` +
        `<span class="p">${r.points ?? 0}</span></div>`).join('') +
    `</div>`;
  }

  // Build the ice and start it living. Shared by `apply` and `showIdle`, because a
  // sub-screen opened before the first beat should show a rink with players on it —
  // "waiting for the drop" over a live warmup, not over a blank card.
  function _mount(p, attackedNet) {
    host.innerHTML = _shell(p, attackedNet);
    rink = host.querySelector('.gdr-rink');
    cam = host.querySelector('.gdr-cam');
    sheet = host.querySelector('.gdr-sheet');
    flowRng = _rng(_hash(`${p.awayTeam || ''}${p.clock || ''}${p.clockSecs || 0}`));
    attackDir = attackedNet === 'r' ? 1 : -1;
    carrier = { side: attackedNet === 'r' ? 'a' : 'h', i: 0 };
    _bindMen(p, attackedNet);
    const pk = puckEl();
    if (pk) pk.classList.remove('caught');
    _writeToken(pk, puckState.x, puckState.y);
    camY = puckState.x;
    flow = null;
    _startLoop();
    _goalieIdlePulse();
  }

  function apply(p) {
    if (!host || !p) return;
    _stop();
    last = p;
    // An intermission is not a play — it has no possession, no shooter and no ice.
    if (p.type === 'intermission') { _clearCard(); _intermission(p); return; }
    const nodes = Array.isArray(p.possession) ? p.possession : null;
    _mount(p, _attackSide(nodes));
    _playPossession(p);
  }

  function _showCaption(text) {
    caption = String(text || '');
    const el = host && host.querySelector('.gdr-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }
  function setCaption(text, opts) {
    const speak = opts && opts.speak;
    if (opts && opts.held) pendingCaption = { text: String(text || ''), speak };
    else { _showCaption(text); if (speak) speak(); }
  }

  // Jumbotron cards — the same sportsfx graphics tv.js would take the whole screen
  // with, rendered compact over the rink so the ice stays visible.
  const CARD = {
    hockeygoal: (fx) => ({ title: fx.hattrick ? 'HAT TRICK' : 'GOAL', cls: 'hot',
      sub: [fx.shooter, fx.assist ? `assist ${fx.assist}` : '', { pp: 'POWER PLAY', sh: 'SHORTHANDED', en: 'EMPTY NET' }[fx.strength] || ''].filter(Boolean).join(' · ') }),
    hockeyfight: (fx) => ({ title: 'GLOVES OFF', sub: `${fx.winner} def. ${fx.loser}`, cls: 'out' }),
    hockeydeath: (fx) => ({ title: 'SUDDEN DEATH', sub: fx.player || '', cls: 'dead' }),
    hockeycup: (fx) => ({ title: 'COLDWATER CUP', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: 'hot' }),
    matchup: (fx) => ({ title: 'CLUSTER PUCK', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: '' }),
    gamewin: (fx) => ({ title: 'FINAL', sub: fx.winner ? `${fx.winner} ${fx.winScore}–${fx.loseScore}` : '', cls: 'final' }),
    champion: (fx) => ({ title: '🏆 CHAMPIONS', sub: fx.winner || '', cls: 'hot' }),
  };
  function _renderCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    const m = CARD[fx.kind](fx);
    let el = host.querySelector('.gdr-jumbo');
    if (!el) { el = document.createElement('div'); el.className = 'gdr-jumbo'; host.appendChild(el); }
    el.innerHTML = `<div class="gdr-jumbo-brand">${cphlMark('20px')}</div>` +
      `<div class="gdr-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gdr-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gdr-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  function showCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    if (playAnimating) pendingCard = fx; else _renderCard(fx);
  }
  function _clearCard() { if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; } host?.querySelector('.gdr-jumbo')?.remove(); }

  // Opened before a beat arrived. Real ice, real men, circulating — with the lockup
  // over the top. Blank was always the wrong answer here: the sub-screen's whole claim
  // is that there's a game on.
  function showIdle() {
    if (!host) return;
    _stop(); _clearCard();
    const p = last || {};
    _mount(p, 'r');
    const veil = document.createElement('div');
    veil.className = 'gdr-idle';
    veil.innerHTML = cphlLockup('Rinkside', '46px') + `<div class="gdr-idle-sub">Waiting for the drop…</div>`;
    host.querySelector('.gdr-wrap')?.appendChild(veil);
  }

  function clear() {
    _stop(); _clearCard(); _stopLoop();
    if (host) host.innerHTML = '';
    rink = null; cam = null; sheet = null; men = [];
    caption = ''; pendingCaption = null; last = null; flow = null; carrier = null;
  }

  return { apply, clear, setCaption, showIdle, showCard };
}

// Test hook — the pure geometry, exercised by the offline harness.
export const __test = {
  GEO, DOTS, SAVE, ROLES, SHEET_W, SHEET_L,
  rinkSvg: _rinkSvg, netSvg: _netSvg, goalieSvg: _goalieSvg, skaterSvg: _skaterSvg,
  sx: _sx, sy: _sy,
};
