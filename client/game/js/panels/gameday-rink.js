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
// THE GEOMETRY IS NOT DECORATIVE. Two facts fell out of the sim for free and the whole
// view is built on them:
//
//   · The keyframes are already in rink coordinates, 0..1 across the sheet, and a shot's
//     final keyframe lands at x≈0.955 — while the GOAL LINE sits at 0.925. So a goal's
//     last keyframe is, without anyone arranging it, a puck that has crossed the line
//     and is still travelling. The cage's back mesh is at 0.975. The puck crosses, then
//     hits the mesh, and the mesh is what stops it. That is the actual event.
//   · The nine faceoff dots are the sim's `dot` ids (see FACEOFF_DOTS in hockey.js),
//     laid out here at their real positions. `aZL` is drawn in the away end because the
//     away side defends the left of the sheet, which is the same convention the sim's
//     possession keyframes use (side 0 attacks right).
//
// THE GOALIE IS THE POINT. He is an articulated SVG — mask, chest, blocker, glove, two
// pads, stick — not a dot, because every save type in the sim is a DIFFERENT save and
// a top-down blob can't tell you which. He tracks the puck along his crease while play
// develops, then plays the shot the way the sim says it was played: chest, glove, pad,
// poke, or beaten.

import { cphlMark, cphlLockup } from './cphl-brand.js';

function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── rink geometry (fractions of the .gdr-rink box) ──────────────────────────────
// Proportioned off a real sheet (200×85) squashed to the panel's aspect: the zones
// keep their relative depth so the neutral zone reads as the short one it is.
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

// Where the five skaters stand when nothing is happening — a 1-2-2 that reads as a
// formation rather than a scatter. Mirrored for the side defending the right end.
const FORMATION = [
  [0.30, 0.50],   // C
  [0.38, 0.26],   // LW
  [0.38, 0.74],   // RW
  [0.20, 0.36],   // D
  [0.20, 0.64],   // D
];

// Motion budget. A broadcast line holds ~10s on air, so the whole possession has to
// resolve well inside that and still leave the outcome on screen to be read.
const T_STEP = 340;          // between possession keyframes
const T_SHOT = 190;          // the shot itself — fast, it's the only quick thing
const T_SETTLE = 620;        // the beat after the puck stops before the caption lands
const T_DRAW = 520;          // faceoff: centres in, puck down, swept back

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const pct = (v) => `${(clamp01(v) * 100).toFixed(2)}%`;

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

// ── the net ─────────────────────────────────────────────────────────────────────
// A cage with depth, drawn behind the goal line so the puck can be INSIDE it. The mesh
// is a real grid element so it can bulge: a goal scales the mesh outward from the line
// and snaps it back, which is the single most recognisable image in the sport.
//
// `side` −1 = the left-hand net (the away end), +1 = the right-hand net.
function _netSvg(side) {
  const gl = side < 0 ? GEO.goalLine[0] : GEO.goalLine[1];
  const back = side < 0 ? GEO.cageBack[0] : GEO.cageBack[1];
  const x0 = Math.min(gl, back) * 100, x1 = Math.max(gl, back) * 100;
  const y0 = (0.5 - GEO.netHalf) * 100, y1 = (0.5 + GEO.netHalf) * 100;
  const w = x1 - x0, h = y1 - y0;
  const meshId = `gdrMesh${side < 0 ? 'L' : 'R'}`;
  // Mesh lines are drawn per-cage rather than as a <pattern> so the bulge transform
  // has something local to scale — a pattern fill can't deform.
  let mesh = '';
  for (let i = 1; i < 7; i++) { const y = y0 + (h * i / 7); mesh += `<line x1="${x0}" y1="${y.toFixed(2)}" x2="${x1}" y2="${y.toFixed(2)}"/>`; }
  for (let i = 1; i < 4; i++) { const x = x0 + (w * i / 4); mesh += `<line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${y1}"/>`; }
  return (
    `<g class="gdr-net" data-side="${side < 0 ? 'l' : 'r'}" style="--gdr-net-x:${(side < 0 ? x0 : x1).toFixed(2)}%">` +
      `<g class="gdr-net-mesh" id="${meshId}">${mesh}</g>` +
      // the cage frame: posts on the goal line, back bar, and the two side bars
      `<path class="gdr-net-frame" d="M${side < 0 ? x1 : x0} ${y0} L${side < 0 ? x0 : x1} ${y0} L${side < 0 ? x0 : x1} ${y1} L${side < 0 ? x1 : x0} ${y1}"/>` +
      // The two posts, drawn ON the goal line — the puck is only in when it's past
      // the plane they define, so they're the reference the crossing is read against.
      `<circle class="gdr-net-post-cap" cx="${gl * 100}" cy="${y0}" r="0.9"/>` +
      `<circle class="gdr-net-post-cap" cx="${gl * 100}" cy="${y1}" r="0.9"/>` +
      `<g class="gdr-net-lamp"><circle cx="${(side < 0 ? x0 - 1.6 : x1 + 1.6)}" cy="50" r="1.6"/></g>` +
    `</g>`
  );
}

// Static rink markings. Pure — built once per game and never touched again, so all the
// per-beat work is transform-only.
function _rinkSvg() {
  const [glL, glR] = GEO.goalLine, [blL, blR] = GEO.blue;
  const dots = Object.entries(DOTS).map(([id, [x, y]]) => {
    const isC = id === 'C';
    const ring = (id === 'C' || /Z/.test(id))
      ? `<circle class="gdr-dot-ring" cx="${x * 100}" cy="${y * 100}" r="${isC ? 9.5 : 9.5}"/>` : '';
    return `<g class="gdr-dot ${isC ? 'centre' : /Z/.test(id) ? 'zone' : 'neutral'}" data-dot="${id}">` +
      ring + `<circle class="gdr-dot-spot" cx="${x * 100}" cy="${y * 100}" r="1.5"/></g>`;
  }).join('');
  const crease = (side) => {
    const gl = (side < 0 ? glL : glR) * 100, d = side < 0 ? 1 : -1;
    const r = GEO.creaseR * 100;
    return `<path class="gdr-crease" d="M${gl} ${50 - r * 0.86} A ${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${gl} ${50 + r * 0.86} Z" transform="translate(${d * 0} 0)"/>`;
  };
  return (
    `<svg class="gdr-ice" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<rect class="gdr-ice-bed" x="0" y="0" width="100" height="100" rx="7"/>` +
      // zones
      `<rect class="gdr-zone-att" x="0" y="0" width="${blL * 100}" height="100"/>` +
      `<rect class="gdr-zone-att" x="${blR * 100}" y="0" width="${100 - blR * 100}" height="100"/>` +
      crease(-1) + crease(1) +
      `<line class="gdr-line goal" x1="${glL * 100}" y1="4" x2="${glL * 100}" y2="96"/>` +
      `<line class="gdr-line goal" x1="${glR * 100}" y1="4" x2="${glR * 100}" y2="96"/>` +
      `<line class="gdr-line blue" x1="${blL * 100}" y1="0" x2="${blL * 100}" y2="100"/>` +
      `<line class="gdr-line blue" x1="${blR * 100}" y1="0" x2="${blR * 100}" y2="100"/>` +
      `<line class="gdr-line red" x1="50" y1="0" x2="50" y2="100"/>` +
      dots +
      _netSvg(-1) + _netSvg(1) +
      `<rect class="gdr-boards" x="0.4" y="0.4" width="99.2" height="99.2" rx="7"/>` +
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
//   caption  the neutral label under the rink (the announcer's line is separate)
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
  let rink = null;              // the persistent .gdr-rink element (tokens live here)
  let caption = '';
  let pendingCaption = null;
  let pendingCard = null;
  let playAnimating = false;
  let cardTimer = null;
  let last = null;              // last payload, for the shell's header/strip

  function _stop() { timers.forEach(clearTimeout); timers = []; playAnimating = false; pendingCard = null; }
  function _t(ms, fn) { timers.push(setTimeout(fn, Math.max(0, ms))); }
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
      window.AudioEngine.playSfx(window.HockeySfx.variant(def, seed == null ? (idx * 2654435761) >>> 0 : seed));
      return;
    }
    if (def && window.AudioEngine?.playSfx) { window.AudioEngine.playSfx(def); return; }
    window.HockeySfx?.play?.(id, seed);
  }
  // Crowd reactions ride slightly behind the event they're reacting to — a crowd that
  // roars on the same frame as the goal sounds like a laugh track.
  function _crowd(key, delay) { _t(delay == null ? 220 : delay, () => _sfx(key)); }

  const q = (sel) => rink && rink.querySelector(sel);
  const puck = () => q('.gdr-puck');
  const goalieEl = (side) => q(`.gdr-goalie[data-side="${side}"]`);

  // Move a token to fractional rink coords with a timed transition.
  function _move(el, x, y, ms, ease) {
    if (!el) return;
    el.style.transition = ms ? `left ${ms}ms ${ease || 'linear'}, top ${ms}ms ${ease || 'linear'}` : 'none';
    el.style.left = pct(x); el.style.top = pct(y);
  }
  function _place(el, x, y) { _move(el, x, y, 0); }

  // ── the goalie ────────────────────────────────────────────────────────────────
  // He is never idle. Between shots he shuffles across his crease to stay square to
  // the puck — the depth of a goalie's game is lateral, and a still goalie reads as a
  // dead sprite. `_goalieTrack` is called on every keyframe.
  function _goalieTrack(side, puckY, ms) {
    const g = goalieEl(side); if (!g) return;
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    // He plays out from the line a little, and covers only a fraction of the lateral
    // spread — overselling this makes him look like he's on rails.
    const depth = side === 'l' ? gl + 0.028 : gl - 0.028;
    const y = 0.5 + (clamp01(puckY) - 0.5) * 0.42;
    _move(g, depth, y, ms, 'cubic-bezier(.4,0,.3,1)');
  }
  function _goaliePose(side, cls, holdMs) {
    const g = goalieEl(side); if (!g) return;
    g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-${cls}`;
    g.dataset.side = side;
    if (holdMs) _t(holdMs, () => { if (g.isConnected) g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-ready`; });
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

  // Short-lived effect token (spray, ring, whistle) at rink coords.
  function _spawn(cls, x, y, life) {
    const layer = q('.gdr-fx'); if (!layer) return null;
    const el = document.createElement('div');
    el.className = cls; el.style.left = pct(x); el.style.top = pct(y);
    layer.appendChild(el); _t(life, () => el.remove());
    return el;
  }

  // ── shell ─────────────────────────────────────────────────────────────────────
  // Sweaters. The colours ride the payload (the sim derives them from the club name),
  // so both sides wear their own and the view holds no palette that could drift from
  // the league's. A club with no colours falls back to the generic att/def styling.
  function _skaters(sideCls, side, colours) {
    const style = colours ? `--gdr-jersey:${colours[0]};--gdr-trim:${colours[1]};` : '';
    return FORMATION.map(([fx, fy], i) => {
      const x = side === 'l' ? fx : 1 - fx;
      return `<div class="gdr-skater ${sideCls}${colours ? ' clubbed' : ''}" data-i="${i}" style="${style}left:${pct(x)};top:${pct(fy)}"></div>`;
    }).join('');
  }

  // `attackedNet` is the end being shot at this beat. The attackers are parked at the
  // OTHER end (the one they're breaking out of) and the defenders in the end under
  // siege — without this the formation and the rush run in opposite directions on a
  // home-team chance, which reads as the wrong team attacking.
  function _shell(p, attackedNet) {
    const attFrom = attackedNet === 'r' ? 'l' : 'r';
    const defFrom = attackedNet;
    return (
      `<div class="gdr-wrap">` +
        `<div class="gdr-head">` +
          `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
          `<span class="gdr-head-score">${_esc(p.awayAbbr || p.awayTeam || 'AWY')} <b>${p.awayScore | 0}</b> — <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || p.homeTeam || 'HOM')}</span>` +
          `<span class="gdr-head-clock">${_esc(p.section || '')} ${_esc(p.clock || '')}</span>` +
          (p.rivalry ? '<span class="gdr-head-rival">RIVALRY</span>' : '') +
          (p.strength && p.strength !== 'even' ? `<span class="gdr-head-str ${_esc(p.strength)}">${_esc(p.strength.toUpperCase())}</span>` : '') +
        `</div>` +
        `<div class="gdr-rink">` +
          _rinkSvg() +
          `<div class="gdr-fx"></div>` +
          `<div class="gdr-skaters">${_skaters('att', attFrom, p.attackingColours)}${_skaters('def', defFrom, p.defendingColours)}</div>` +
          `<div class="gdr-goalie left pose-ready" data-side="l">${_goalieSvg()}</div>` +
          `<div class="gdr-goalie right pose-ready" data-side="r">${_goalieSvg()}</div>` +
          `<div class="gdr-puck"></div>` +
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
  // away side on the left, which is the frame `winnerSide` is computed in.
  function _attackSide(nodes) {
    if (!nodes || !nodes.length) return 'r';
    return nodes[nodes.length - 1].p[0] >= 0.5 ? 'r' : 'l';
  }

  // ── the possession ────────────────────────────────────────────────────────────
  function _playPossession(p) {
    const nodes = Array.isArray(p.possession) ? p.possession.slice() : [];
    if (!nodes.length) { _resolveNoPuck(p); return; }
    const side = _attackSide(nodes);
    const pk = puck();
    const kind = p.kind === 'goal' || p.type === 'goal' ? 'goal' : (p.kind || 'save');
    const save = SAVE[kind] || SAVE.save;

    playAnimating = true;
    _place(pk, nodes[0].p[0], nodes[0].p[1]);
    _goaliePose(side, 'ready');
    _goalieTrack(side, nodes[0].p[1], 260);

    let at = 0;
    // Carry: the skater with the puck moves with it, so a "pass" is two players
    // exchanging position rather than a dot teleporting between them.
    nodes.forEach((nd, i) => {
      if (i === 0) return;
      const prev = nodes[i - 1];
      const shot = nd.ev === 'shot';
      const ms = shot ? T_STEP : T_STEP;
      _t(at, () => {
        _move(pk, nd.p[0], nd.p[1], ms, shot ? 'ease-in' : 'ease-in-out');
        _goalieTrack(side, nd.p[1], ms + 60);
        if (nd.ev === 'entry') _flashLine(side);
        if (nd.ev === 'pass') _passTrail(prev.p, nd.p, ms);
        const sk = q(`.gdr-skater.att[data-i="${Math.max(0, nd.carrier | 0) % 5}"]`);
        if (sk && nd.carrier >= 0) _move(sk, nd.p[0] - (side === 'r' ? 0.03 : -0.03), nd.p[1], ms + 90, 'ease-in-out');
        if (shot) { _sfx('shot'); _windUp(sk); }
      });
      at += ms;
    });

    // ── the shot resolves ───────────────────────────────────────────────────────
    const final = nodes[nodes.length - 1];
    _t(at, () => _resolveShot(p, kind, save, side, final));
    _t(at + T_SETTLE, () => _reveal(p));
  }

  // A puck that never got shot (a faceoff, a fight, a whistle) still needs the rink to
  // do something honest, so those beats get their own short pieces below.
  function _resolveNoPuck(p) {
    playAnimating = true;
    if (p.type === 'faceoff') _playFaceoff(p);
    else if (p.type === 'fight') _playFight(p);
    else _t(120, () => {});
    _t(T_DRAW + T_SETTLE, () => _reveal(p));
  }

  function _resolveShot(p, kind, save, side, final) {
    const pk = puck();
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    const back = side === 'l' ? GEO.cageBack[0] : GEO.cageBack[1];
    const dir = side === 'l' ? -1 : 1;
    _goaliePose(side, save.cls, kind === 'goal' ? 2400 : 1400);

    if (kind === 'goal') {
      // THE ONE THAT MATTERS. The puck travels past the goal line — visibly past, the
      // line is drawn and it crosses it — and only then reaches the mesh, which bulges.
      // Two separate motions, because "crossed the line" and "in the net" are two
      // separate facts and the second is the consequence of the first.
      _move(pk, gl, final.p[1], T_SHOT, 'ease-in');
      _t(T_SHOT, () => {
        _crossFlash(side);
        _move(pk, back - dir * 0.006, final.p[1], 150, 'ease-out');
        _sfx('horn', p.hornSeed);   // every barn's horn is that barn's horn
      });
      _t(T_SHOT + 150, () => { _bulge(side); _sfx('net'); _spawn('gdr-spray', back - dir * 0.02, final.p[1], 700); });
      _crowd('roar', T_SHOT + 260);
      return;
    }

    // Everything else stops short of the line. `stop` is measured back from the goal
    // line toward the shooter, so a glove save is caught right on the doorstep and a
    // block dies out at the top of the circle.
    const stopX = gl - dir * save.stop * 0.30;
    _move(pk, stopX, final.p[1], T_SHOT, 'ease-out');
    _t(T_SHOT, () => {
      // Iron. The only non-goal the building reacts to, so it gets the gasp.
      if (kind === 'post') { _clang(side); _sfx('post'); _crowd('gasp'); _move(pk, stopX - dir * 0.06, final.p[1] < 0.5 ? 0.08 : 0.92, 420, 'ease-out'); return; }
      if (kind === 'wide') { _move(pk, gl + dir * 0.03, final.p[1] < 0.5 ? 0.06 : 0.94, 300, 'ease-out'); _sfx('wide'); return; }
      if (kind === 'blocked') { _spawn('gdr-block', stopX, final.p[1], 600); _sfx('block'); return; }
      if (kind === 'pad') { _move(pk, stopX - dir * 0.10, final.p[1] < 0.5 ? 0.16 : 0.84, 380, 'ease-out'); _sfx('pad'); return; }
      if (kind === 'glove') { _sfx('glove'); _stickPuckToGlove(side); return; }
      if (kind === 'breakaway') { _sfx('poke'); _move(pk, stopX - dir * 0.07, final.p[1], 320, 'ease-out'); return; }
      // plain save: held on the chest, and if the sim says he froze it, the whistle
      _sfx('chest');
      // He covered it. The whistle is the reason the next beat is a faceoff in this end.
      if (p.frozen) { _spawn('gdr-whistle', stopX, final.p[1], 900); _t(140, () => _sfx('whistle')); }
    });
  }

  // The trapper closes ON the puck: the puck is parked at the glove and hidden, which
  // is the only way a top-down view can say "he caught it" rather than "it stopped".
  function _stickPuckToGlove(side) {
    const g = goalieEl(side), pk = puck();
    if (!g || !pk) return;
    const gx = parseFloat(g.style.left) / 100, gy = parseFloat(g.style.top) / 100;
    _move(pk, gx + (side === 'l' ? 0.012 : -0.012), gy - 0.045, 120, 'ease-out');
    pk.classList.add('caught');
    _t(1500, () => pk.classList.remove('caught'));
  }

  function _windUp(sk) { if (!sk) return; sk.classList.add('shooting'); _t(420, () => sk.classList.remove('shooting')); }
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
    const pk = puck();
    const a = q('.gdr-skater.att[data-i="0"]'), d = q('.gdr-skater.def[data-i="0"]');
    const dot = q(`.gdr-dot[data-dot="${p.dot}"]`);
    if (dot) { dot.classList.add('live'); _t(2200, () => dot.classList.remove('live')); }
    _move(a, dx - 0.028, dy, T_DRAW * 0.55, 'ease-out');
    _move(d, dx + 0.028, dy, T_DRAW * 0.55, 'ease-out');
    _move(pk, dx, dy - 0.10, 0);
    _t(T_DRAW * 0.55, () => { _move(pk, dx, dy, 130, 'ease-in'); _sfx('drop'); });
    _t(T_DRAW * 0.55 + 150, () => {
      // Won back — toward the winning side's own end, which is what "won it back" means.
      const backX = p.winnerSide === 'def' ? dx + 0.10 : dx - 0.10;
      _move(pk, clamp01(backX), dy + (dy < 0.5 ? 0.05 : -0.05), 300, 'ease-out');
      _sfx('sweep');
      const w = p.winnerSide === 'def' ? d : a;
      if (w) { w.classList.add('shooting'); _t(360, () => w.classList.remove('shooting')); }
    });
  }

  // ── fight ─────────────────────────────────────────────────────────────────────
  // Played off the sim's own exchange list, so the number of punches, who threw each
  // and which landed are the server's facts, not the client's invention.
  function _playFight(p) {
    const ex = Array.isArray(p.exchange) ? p.exchange.slice(0, 10) : [];
    const a = q('.gdr-skater.att[data-i="0"]'), d = q('.gdr-skater.def[data-i="0"]');
    // The exchange names its thrower by NAME, and the only name we can place on the
    // ice is the winner — the server tells us which side he's on. Everything he didn't
    // throw was thrown by the other man, so two facts resolve the whole exchange.
    const winnerIsAtt = p.winnerSide !== 'def';
    const winMan = p.winner || '';
    _move(a, 0.47, 0.5, 320, 'ease-out'); _move(d, 0.53, 0.5, 320, 'ease-out');
    a?.classList.add('fighting'); d?.classList.add('fighting');
    _sfx('gloves');
    let at = 380;
    ex.forEach((e) => {
      _t(at, () => {
        const byWinner = e.thrower === winMan;
        const thrower = (byWinner === winnerIsAtt) ? a : d;
        const taker = thrower === a ? d : a;
        thrower?.classList.add('swing'); _t(120, () => thrower?.classList.remove('swing'));
        if (e.landed) { taker?.classList.add('hit'); _t(150, () => taker?.classList.remove('hit')); _spawn('gdr-hit', 0.5, 0.5, 300); _sfx('punch'); }
        else _sfx('punchMiss');
      });
      at += 170;
    });
    _t(at + 200, () => { a?.classList.remove('fighting'); d?.classList.remove('fighting'); });
  }

  // ── reveal ────────────────────────────────────────────────────────────────────
  function _reveal(p) {
    playAnimating = false;
    if (pendingCaption) { _showCaption(pendingCaption.text); if (pendingCaption.speak) pendingCaption.speak(); pendingCaption = null; }
    if (pendingCard) { _renderCard(pendingCard); pendingCard = null; }
  }

  // ── public ────────────────────────────────────────────────────────────────────
  // ── the intermission board ────────────────────────────────────────────────
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
    rink = null;   // no ice on screen — the beat helpers must not try to move tokens
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

  function apply(p) {
    if (!host || !p) return;
    _stop();
    last = p;
    // An intermission is not a play — it has no possession, no shooter and no ice.
    if (p.type === 'intermission') { _clearCard(); _intermission(p); return; }
    const nodes = Array.isArray(p.possession) ? p.possession : null;
    host.innerHTML = _shell(p, _attackSide(nodes));
    rink = host.querySelector('.gdr-rink');
    // Park everyone before the beat plays, so every beat starts from a legible state
    // rather than wherever the last one happened to leave them.
    const pk = puck();
    if (pk) { pk.classList.remove('caught'); _place(pk, 0.5, 0.5); }
    _place(goalieEl('l'), GEO.goalLine[0] + 0.028, 0.5);
    _place(goalieEl('r'), GEO.goalLine[1] - 0.028, 0.5);
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

  function showIdle() {
    if (!host) return;
    _stop(); _clearCard(); rink = null;
    host.innerHTML =
      `<div class="gdr-idle">` +
        cphlLockup('Rinkside', '46px') +
        `<div class="gdr-idle-sub">Waiting for the drop…</div>` +
      `</div>`;
  }

  function clear() {
    _stop(); _clearCard();
    if (host) host.innerHTML = '';
    rink = null; caption = ''; pendingCaption = null; last = null;
  }

  return { apply, clear, setCaption, showIdle, showCard };
}

// Test hook — the pure geometry, exercised by the offline harness.
export const __test = { GEO, DOTS, SAVE, rinkSvg: _rinkSvg, netSvg: _netSvg, goalieSvg: _goalieSvg };
