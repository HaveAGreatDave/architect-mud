// Gameday · Rink (Rinkside): the animated sub-screen for the CLUSTER PUCK (CPhL) broadcast.
//
// Same contract as gameday.js (the Deadball diamond): it renders a per-beat `gameday`
// payload into whatever host it's handed and exposes { apply, clear, setCaption, showIdle,
// showCard }, which is what lets tv.js pick a view by sport and change nothing else.
//
// Three pieces under ./rink/ do the work, and this file only wires them to the page:
//
//   sim.js       the world: ten skaters, two goalies, two officials, the puck, the glass,
//                blood, limbs, the Zamboni. Stepped at 120 Hz. Between beats it plays
//                cosmetic hockey that never shoots, so the ice is never still.
//   director.js  one payload in, choreography out. The sim already decided the outcome;
//                the director stages it (the shot goes where the save needs it) and fires
//                `onLand` when the play lands, which is when the held caption shows.
//   gl/arena.js  draws it on GLASS 2 (WebGL2): meshes, a depth buffer, a real reflection
//                in the ice. Where there's no WebGL2, or the context is lost, render.js
//                draws the same world through the same camera on a 2-D canvas.
//
// The sim on the server decides everything. Nothing here can change a score.

import { cphlMark, cphlLockup } from './cphl-brand.js';
import { addFullscreenButton, leaveFullscreen } from './view-fullscreen.js';
import { crestSvg, clubOf, onClubs } from './club-crest.js';
import { venueOf, onVenue } from './venue.js';
import { GEO, DOTS } from './rink/geo.js';
import { DT } from './rink/rig.js';
import { SAVE, createDirector } from './rink/director.js';
import { ratingsFor } from './rink/sim.js';
import { loadClassicScript } from '../classic-script.js';

function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// A club's crest beside its name, when the league's identities have arrived (club-crest.js).
function _crest(name, size, cls = '') {
  const c = clubOf(name, 'hockey');
  return c ? `<span class="gdr-crest ${cls}">${crestSvg(c, size, { title: name })}</span>` : '';
}

// The CPhL soundset (client/shared/hockey-sfx.js) is procedural and preset-addressed: the
// rink names the EVENT and the soundset's own table (HockeySfx.eventFor) says what it sounds
// like and how hard. Silent if the file or AudioEngine isn't there: most of the audience is
// reading text.
// how often one sound may repeat, so ten men stopping at once isn't ten scrapes
const SFX_GAP = { stop: 0.9, turn: 1.4, boards: 0.12, glass: 0.12, receive: 0.2, pass: 0.15, tick: 0.9, drop: 0.2, check: 0.15, fall: 0.25, punch: 0.08, stick: 0.1 };
// the sounds a horn or a whistle must not be buried under: while one's sounding, these play
// a little quieter (and the crowd ducks)
const CONTACT = new Set(['receive', 'pass', 'tick', 'stick', 'poke', 'boards', 'glass', 'stop', 'turn', 'sweep', 'block']);

// Jumbotron cards: the same sportsfx graphics tv.js would take the whole screen with,
// rendered compact over the rink so the ice stays visible. A goal has none: the lamp, the
// horn and the wipe into the replay announce it, and a card sat over the scorer's
// celebration (the full-screen TV card still shows it).
const CARD = {
  hockeyfight: (fx) => ({ title: 'GLOVES OFF', sub: `${fx.winner} def. ${fx.loser}`, cls: 'out', club: fx.team }),
  hockeydeath: (fx) => ({ title: 'SUDDEN DEATH', sub: fx.player || '', cls: 'dead' }),
  hockeycup: (fx) => ({ title: 'COLDWATER CUP', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: 'hot' }),
  matchup: (fx) => ({ title: 'CLUSTER PUCK', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: '' }),
  gamewin: (fx) => ({ title: 'FINAL', sub: fx.winner ? `${fx.winner} ${fx.winScore}–${fx.loseScore}` : '', cls: 'final', club: fx.winner }),
  champion: (fx) => ({ title: '🏆 CHAMPIONS', sub: fx.winner || '', cls: 'hot', club: fx.winner }),
};

// THE GLOWING PUCK is a viewer's own setting, kept in this browser: a blue halo round the
// puck and a comet tail behind a fast one (rink/hud.js draws it), for anyone who loses a
// small black puck against the boards and the crowd. The button on the picture toggles it.
const GLOW_KEY = 'rinkGlowPuck';
function glowSaved(win) { try { return win?.localStorage?.getItem(GLOW_KEY) === '1'; } catch { return false; } }
function glowSave(win, on) { try { win?.localStorage?.setItem(GLOW_KEY, on ? '1' : '0'); } catch { /* storage blocked */ } }
// THE INK, the thick dark outline round the players (gl/arena.js), is on unless a viewer turns
// it off, and that's kept in this browser too.
const INK_KEY = 'rinkInk';
function inkSaved(win) { try { return win?.localStorage?.getItem(INK_KEY) !== '0'; } catch { return true; } }
function inkSave(win, on) { try { win?.localStorage?.setItem(INK_KEY, on ? '1' : '0'); } catch { /* storage blocked */ } }
// THE X-RAY GORE: how much a grave hit's X-ray replay shows (gl/arena-xray.js): 'full' (his
// insides and the blood), 'bones' (the skeleton and the break) or 'off' (no X-ray, the hit
// replayed as any other). Full unless a viewer dials it back with the button on the picture.
const GORE_KEY = 'rinkXrayGore', GORES = ['full', 'bones', 'off'];
const GORE_TITLE = { full: 'X-ray replays: full gore', bones: 'X-ray replays: bones only', off: 'X-ray replays: off' };
function goreSaved(win) { try { const v = win?.localStorage?.getItem(GORE_KEY); return GORES.includes(v) ? v : 'full'; } catch { return 'full'; } }
function goreSave(win, v) { try { win?.localStorage?.setItem(GORE_KEY, v); } catch { /* storage blocked */ } }
// The camera: the broadcast view across the ice, or the NHL 96 view up and down it.
const CAM_KEY = 'rinkCamView';
function camSaved(win) { try { return win?.localStorage?.getItem(CAM_KEY) === 'vertical' ? 'vertical' : null; } catch { return null; } }
function camSave(win, v) { try { win?.localStorage?.setItem(CAM_KEY, v); } catch { /* storage blocked */ } }

export function createRinkView(host, opts = {}) {
  const doc = host ? host.ownerDocument : null;
  const win = doc ? doc.defaultView : null;
  let glow = opts.glow != null ? !!opts.glow : glowSaved(win);
  let ink = opts.ink != null ? !!opts.ink : inkSaved(win);
  let camView = opts.camera || camSaved(win);
  let gore = GORES.includes(opts.gore) ? opts.gore : goreSaved(win);
  let caption = '', pendingCaption = null, pendingCard = null, cardTimer = null, holdTimer = null;
  let last = null, landed = true, raf = 0, lastFrame = 0, frameAvg = 0, acc = 0, mounted = false, speed = opts.speed || 1;
  let W = null, D = null, R = null, ice = null, canvas = null, modsP = null, mods = null;
  const sfxAt = {};
  let costAvg = 0;

  // The ./rink modules load on first mount, so tv.js's import of this file stays cheap.
  // The CPhL soundset (hockey-sfx.js, a classic script) comes with them rather than at boot:
  // nothing else plays it. It joins the dev-panel catalog through addBank, so an override
  // saved there still wins. Not awaited: until it lands, _sfx and the crowd stay silent,
  // as they did when it was missing. A page (or gate) that already has it skips this.
  function loadSoundset() {
    if (!win || win.HockeySfx || win !== globalThis.window) return;
    loadClassicScript('/shared/hockey-sfx.js')
      .then(() => win.SFXCatalog?.addBank?.(win.HockeySfx?.BUILTINS, 'hockey', 'Hockey (Cluster Puck broadcast)'))
      .catch((err) => console.error('[rink] soundset failed to load:', err?.message));
  }
  function loadMods() {
    if (!modsP) loadSoundset();
    return (modsP ??= Promise.all([import('./rink/textures.js'), import('./rink/sim.js'), import('./rink/render.js'), import('./gl/arena.js')])
      .then(([t, s, r, a]) => (mods = { createIce: t.createIce, createWorld: s.createWorld, createRenderer: r.createRenderer, createArenaRenderer: a.createArenaRenderer })));
  }

  function _sfx(key, o) {
    const H = win?.HockeySfx, AE = win?.AudioEngine;
    if (!W || !H?.eventFor || !AE?.playSfx) return;
    const pick = H.eventFor(key, o || {});
    if (pick) {
      const gap = SFX_GAP[key] || 0.03;
      if (W.t - (sfxAt[key] ?? -9) < gap) return;
      sfxAt[key] = W.t;
      const seed = o && o.seed != null ? o.seed : ((W.t * 1000) | 0);
      // the catalog's copy, which carries any override saved in the dev panel (null: muted there)
      const def = win.SFXCatalog?.get ? win.SFXCatalog.get(pick.id) : H.get(pick.id);
      if (def) {
        // a contact under a horn or a whistle steps back; a sound off to one side of the
        // picture comes a little from that side
        const under = CONTACT.has(key) && W.t < loudUntil ? 0.6 : 1;
        const x = o && Number.isFinite(o.x) ? o.x : CONTACT.has(key) && W.puck ? W.puck.x : null;
        const pan = x != null && W.cam?.focus ? Math.max(-0.5, Math.min(0.5, (x - W.cam.focus[0]) / 90)) : 0;
        AE.playSfx(H.variant(def, seed, 1, pick.intensity), under, pan ? { pan } : {});
        if (key === 'horn') loudUntil = W.t + 2;
        else if (key === 'whistle') loudUntil = Math.max(loudUntil, W.t + (o && o.long ? 0.5 : 0.25));
      }
    }
    crowdHears(key, o || {});
  }

  // ── the crowd ─────────────────────────────────────────────────────────────
  // One bed for the life of the view (HockeySfx.crowdBed), built the first time a play
  // arrives and steered from then on: never retriggered, gone with the view. The plays set
  // its state; the moments (a shot, the iron, a goal, a big hit) move it and let it settle.
  let crowd = null, crowdBack = null, loudUntil = 0;
  function crowdOn() {
    if (crowd != null) return crowd || null;
    const H = win?.HockeySfx;
    crowd = (H?.crowdBed && win?.AudioEngine?.engineNodes && H.crowdBed()) || false;
    if (crowd) crowd.start().setState('active');
    return crowd || null;
  }
  // back to the run of play after a moment, unless something else has moved it since
  function crowdSettle(after, to = 'active') {
    if (crowdBack) clearTimeout(crowdBack);
    crowdBack = setTimeout(() => { crowdBack = null; if (crowd) crowd.setState(to); }, after * 1000);
  }
  // the home crowd: whose side a goal, a save or a hit is on
  const homeSide = (p) => (p && p.homeTeam ? (p.teamName === p.homeTeam) : true);
  // (the run of play is 'active': the crowd rises for a moment and comes back to it, and a
  // rush on its own doesn't move it, or it would sit high all game)
  function crowdPlay(p) {
    const c = crowdOn();
    if (!c || !p) return;
    if (crowdBack) { clearTimeout(crowdBack); crowdBack = null; }
    switch (p.type) {
      case 'intermission': case 'injury': case 'death': c.setState('quiet'); break;
      case 'penalty': c.setState('penalty'); crowdSettle(4); break;
      case 'pull': c.setState('chance'); break;
      // (a fight is long now: the crowd stays up through it and comes down at the box)
      case 'fight': c.setState('shot').cheer(); crowdSettle(20); break;
      case 'brawl': c.setState('fight').cheer(); crowdSettle(30); break;
      default: c.setState('active');
    }
  }
  function crowdHears(key, o) {
    const c = crowd || null, p = last;
    if (!c) return;
    switch (key) {
      case 'shot': if (!o.soft) { c.setState('shot'); crowdSettle(1.6); } break;
      case 'post': c.gasp(); crowdSettle(2); break;
      case 'glove': case 'pad': case 'chest': if (!homeSide(p)) c.cheer(); crowdSettle(1.6); break;
      case 'whistle': c.duck(3, o.long ? 0.5 : 0.3); break;
      case 'horn':
        c.duck(5, 0.3);
        if (homeSide(p)) { c.setState('goal'); W && W.schedule(0.2, () => crowd && crowd.celebrate()); crowdSettle(6); }
        else { c.setState('active'); W && W.schedule(0.15, () => _sfx('groan')); }
        break;
      case 'roar': c.setState('chance').cheer(); crowdSettle(3); break;
      case 'check': if (!o.soft) c.cheer(); break;
      case 'gloves': c.setState('fight').cheer(); break;
      // a fight: every big one lands with a roar and some of the rest with a shout; the
      // building goes up for a knockdown and the sweater over a head, and gasps if he
      // doesn't get up; a fight nobody won is booed
      case 'punch': if (o.big || Math.random() < 0.35) c.cheer(); break;
      case 'knockout':
        c.setState('goal').cheer(); crowdSettle(4);
        if (o.hurt) W && W.schedule(1.4, () => { if (crowd) { crowd.gasp(); crowd.setState('quiet'); } });
        break;
      case 'fightTurtle': c.setState('fight').cheer(); crowdSettle(3); break;
      case 'fightDraw': _sfx('boo'); crowdSettle(2); break;
      case 'periodHorn': c.duck(4, 0.6); break;
      // the X-ray: the building goes quiet under it, and gasps as the bone goes
      case 'xrayIn': c.duck(3, 0.4); break;
      case 'boneCrack': c.gasp(); break;
    }
  }

  function shell() {
    return `<div class="gdr-wrap">` +
      `<div class="gdr-head"></div>` +
      `<div class="gdr-rink"><canvas class="gdr-canvas" aria-label="Rinkside: the play on the ice"></canvas><canvas class="gdr-hud" aria-hidden="true"></canvas>` +
        `<button type="button" class="gdr-glow" aria-pressed="${glow}" title="Glowing puck" aria-label="Glowing puck">` +
          `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.28"/><ellipse cx="12" cy="13" rx="6" ry="3.4" fill="#0b0c0f"/><ellipse cx="12" cy="11.6" rx="6" ry="3.4" fill="#2c2f36"/></svg>` +
        `</button>` +
        `<button type="button" class="gdr-ink" aria-pressed="${ink}" title="Outlines" aria-label="Outlines">` +
          `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="7" r="3.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6.5 21v-4.5a5.5 5.5 0 0 1 11 0V21" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>` +
        `</button>` +
        `<button type="button" class="gdr-gore" data-gore="${gore}" title="${GORE_TITLE[gore]}" aria-label="${GORE_TITLE[gore]}">` +
          `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5a2.3 2.3 0 0 1 3.6 1.9h2.8A2.3 2.3 0 1 1 17 9.5l-7.5 7.5A2.3 2.3 0 1 1 6.5 13.5l7.5-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle class="gdr-gore-drop" cx="18" cy="18" r="3" fill="#c2182b"/></svg>` +
        `</button>` +
        `<button type="button" class="gdr-cam" aria-pressed="${camView === 'vertical'}" title="Vertical camera" aria-label="Vertical camera">` +
          `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.4"/><path d="M12 5.2l-2 2.2h4zM12 18.8l-2-2.2h4z" fill="currentColor"/></svg>` +
        `</button></div>` +
      `<div class="gdr-strip"></div>` +
      `<div class="gdr-rush" hidden></div>` +
      `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
    `</div>`;
  }
  // THE CLOCK RUNS BETWEEN PLAYS. The booth sends the clock once a play, 18 to 54 seconds
  // of it apart, so the header ticks down a second at a time toward the latest one (faster
  // when it has fallen behind) and holds there until the next, as a clock stops at a
  // whistle. A new period, or a clock that has gone up, starts again where it says.
  const clk = { shown: null, aim: 0, section: null, text: '' };
  const clockText = (s) => { const t = Math.max(0, Math.ceil(s - 1e-6)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  function clockAim(p) {
    if (!Number.isFinite(p.clockSecs)) { clk.shown = null; return (clk.text = p.clock || ''); }
    clk.aim = p.clockSecs;
    if (clk.shown == null || clk.section !== p.section || clk.aim > clk.shown) clk.shown = clk.aim;
    clk.section = p.section;
    return (clk.text = clockText(clk.shown));
  }
  function clockTick(real) {
    if (clk.shown == null || clk.shown <= clk.aim) return;
    clk.shown = Math.max(clk.aim, clk.shown - real * Math.max(1, (clk.shown - clk.aim) / 6));
    const t = clockText(clk.shown);
    if (t === clk.text) return;
    clk.text = t;
    const el = host?.querySelector('.gdr-head-time'); if (el) el.textContent = t;
  }
  // the header redraws with crests when the club identities turn up mid-game
  let offClubs = null;
  // Until the play lands the header can't say how it ends: a goal's payload carries the
  // score after the goal, and the strip names the result. Up there during the rush they
  // would call the goal before it happens, so the strip reads LIVE until then.
  function head(p) {
    if (!offClubs) offClubs = onClubs(() => { if (last && host) head(last); });
    const el = host?.querySelector('.gdr-head'); if (!el) return;
    const live = !landed && p.type !== 'intermission';
    const sc = live && p.scoreBefore ? p.scoreBefore : { away: p.awayScore, home: p.homeScore };
    el.innerHTML =
      `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
      `<span class="gdr-head-score">${_crest(p.awayTeam, 16)}${_esc(p.awayAbbr || p.awayTeam || 'AWY')} <b>${sc.away | 0}</b>: <b>${sc.home | 0}</b> ${_esc(p.homeAbbr || p.homeTeam || 'HOM')}${_crest(p.homeTeam, 16)}</span>` +
      `<span class="gdr-head-clock">${p.type === 'intermission' ? 'INTERMISSION' : `${_esc(p.section || '')} <span class="gdr-head-time">${_esc(clockAim(p))}</span>`}</span>` +
      (p.rivalry ? '<span class="gdr-head-rival">RIVALRY</span>' : '') +
      (p.strength && p.strength !== 'even' && p.type !== 'intermission' ? `<span class="gdr-head-str ${_esc(p.strength)}">${_esc(p.strength.toUpperCase())}</span>` : '');
    const st = host.querySelector('.gdr-strip');
    if (st) st.innerHTML = p.type === 'intermission' ? '' : live
      ? `<span class="gdr-strip-desc">Live</span><span class="gdr-strip-names">${_esc(p.possession ? p.attackingTeam || '' : '')}</span>`
      : `<span class="gdr-strip-desc">${_esc(p.desc || '')}</span>` +
        `<span class="gdr-strip-names">${_esc(p.shooter || '')}${p.assist ? ` · assist ${_esc(p.assist)}` : ''}${p.goalie ? ` · vs ${_esc(p.goalie)}` : ''}</span>`;
    const ru = host.querySelector('.gdr-rush');
    if (ru) { ru.hidden = !p.rush; ru.textContent = p.rush || ''; }
  }

  // ── the intermission board ────────────────────────────────────────────────
  // A panel over the left of the ice, so the Zamboni lapping the sheet stays in shot.
  function board(p) {
    const rink = host?.querySelector('.gdr-rink'); if (!rink) return;
    rink.querySelector('.gdri')?.remove();
    if (!p) return;
    const goals = Array.isArray(p.goals) ? p.goals : [];
    const rows = goals.length
      ? goals.map((g) => `<div class="gdri-goal"><span class="t">${_esc(g.clockStr || '')}</span><span class="n">${_esc(g.shooter || '')}</span>` +
          `<span class="a">${g.assist ? `from ${_esc(g.assist)}` : 'unassisted'}</span><span class="c">${_crest(g.teamName, 14)}${_esc(g.teamName || '')}</span>` +
          (g.strength && g.strength !== 'even' ? `<span class="s">${_esc(String(g.strength).toUpperCase())}</span>` : '') + `</div>`).join('')
      : `<div class="gdri-none">No goals in the ${_esc(p.section || 'period')}.</div>`;
    const cas = (p.casualties || []).length ? `<div class="gdri-cas">Carried off: ${(p.casualties || []).map(_esc).join(', ')}. No replacements.</div>` : '';
    const stand = Array.isArray(p.standings) && p.standings.length
      ? `<div class="gdri-stand"><div class="gdri-stand-head">CPhL · PTS</div>` + p.standings.slice(0, 6).map((r, i) =>
          `<div class="gdri-stand-row${r.team === p.awayTeam || r.team === p.homeTeam ? ' me' : ''}"><span class="r">${i + 1}</span><span class="t">${_crest(r.team, 14)}${_esc(r.team)}</span><span class="p">${r.points ?? 0}</span></div>`).join('') + `</div>` : '';
    const el = doc.createElement('div');
    el.className = 'gdri over';
    el.innerHTML = `<div class="gdri-main">` +
      `<div class="gdri-title">END OF THE ${_esc((p.section || '').toUpperCase())}</div><div class="gdri-sub">Scoring summary</div>` +
      `<div class="gdri-goals">${rows}</div>${cas}` +
      `<div class="gdri-stats"><span><i>SOG</i> ${_esc(p.awayAbbr || 'AWY')} ${p.shotsAway | 0} · ${_esc(p.homeAbbr || 'HOM')} ${p.shotsHome | 0}</span>` +
      `<span><i>PEN</i> ${p.penalties | 0}</span><span><i>FIGHTS</i> ${p.fights | 0}</span><span><i>HITS</i> ${p.hits | 0}</span></div>` +
      `<div class="gdri-next">Back for the ${_esc(p.nextOrd || 'next period')}</div></div>${stand}`;
    rink.appendChild(el);
  }

  // ── the loop ──────────────────────────────────────────────────────────────
  // Fixed 120 Hz steps under a display-rate render. A big hit freezes time for a few
  // frames (`W.hitstop`), which is most of why it lands.
  function frame(now) {
    raf = win.requestAnimationFrame(frame);
    if (!canvas || !canvas.isConnected) { stop(); return; }
    const raw = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    // VSYNC JITTER ISN'T TIME. Frames arrive a millisecond or two either side of the
    // display's steady rate; stepped as they come, a 120 Hz world alternates one step and
    // three a frame and the skating stutters. A frame within 4 ms of the running average is
    // stepped as the average; a real hiccup is stepped as it was.
    frameAvg = frameAvg ? frameAvg + (raw - frameAvg) * 0.1 : raw;
    const real = Math.abs(raw - frameAvg) < 0.004 ? frameAvg : raw;
    let dt = real * speed;
    if (W.hitstop > 0) { W.hitstop -= real; dt *= 0.3; }
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 24) { W.step(DT); acc -= DT; n++; }
    if (n === 24) acc = 0;
    // drawn between the last two steps by what's left over, so the screen's rate and the
    // world's never beat against each other (see sim.js)
    W.alpha = acc / DT;
    if (R.lost) fallback();
    R.render(now);
    l3Tick();
    clockTick(raw);
    govern(raw);
  }
  // QUALITY FOLLOWS THE REAL FRAME TIME, not the time spent in our own code: most of a
  // canvas frame is the browser rasterising it, which no timer in here sees. Sustained slow
  // frames step the picture down a rung (reflected bodies, then resolution, then coarser
  // ice); a long run of quick ones steps it back up.
  const RUNGS_2D = [
    { reflBodies: true, dpr: 1.5, iceStep: 2 }, { reflBodies: false, dpr: 1.5, iceStep: 2 },
    { reflBodies: false, dpr: 1, iceStep: 2 }, { reflBodies: false, dpr: 1, iceStep: 3 },
  ];
  let rung = 0, slow = 0, quick = 0;
  function govern(real) {
    const RUNGS = R.rungs || RUNGS_2D;
    costAvg = costAvg ? costAvg * 0.9 + real * 1000 * 0.1 : real * 1000;
    if (costAvg > 24) { slow += real; quick = 0; } else if (costAvg < 15) { quick += real; slow = 0; } else { slow = quick = 0; }
    if (slow > 1.2 && rung < RUNGS.length - 1) { rung++; slow = 0; Object.assign(R.quality, RUNGS[rung]); }
    if (quick > 8 && rung > 0) { rung--; quick = 0; Object.assign(R.quality, RUNGS[rung]); }
  }
  // GLASS 2 first; the 2-D renderer when there's no WebGL2 or the caller asks for it.
  function makeRenderer() {
    const hud = host.querySelector('.gdr-hud');
    const gl = opts.renderer !== '2d' && mods.createArenaRenderer ? mods.createArenaRenderer(canvas, hud, W, ice) : null;
    R = gl || mods.createRenderer(canvas, W, ice);
    rung = 0; slow = quick = 0;
    if (camView) R.view = camView;
    R.glow = glow; R.ink = ink; R.xrayGore = gore;
  }
  function setGore(v) {
    gore = v;
    if (R) R.xrayGore = v;
    if (W) W.xrayGore = v;
    const b = host?.querySelector('.gdr-gore');
    if (b) { b.dataset.gore = v; b.title = GORE_TITLE[v]; b.setAttribute('aria-label', GORE_TITLE[v]); }
  }
  function setInk(on) {
    ink = !!on;
    if (R) R.ink = ink;
    host?.querySelector('.gdr-ink')?.setAttribute('aria-pressed', String(ink));
  }
  function setCam(v) {
    camView = v;
    if (R) R.view = v;
    host?.querySelector('.gdr-cam')?.setAttribute('aria-pressed', String(v === 'vertical'));
  }
  function setGlow(on) {
    glow = !!on;
    if (R) R.glow = glow;
    host?.querySelector('.gdr-glow')?.setAttribute('aria-pressed', String(glow));
  }
  // A lost WebGL context doesn't come back as a 2-D one: the canvas is replaced, and the
  // 2-D renderer carries on with the same world and camera framing.
  function fallback() {
    const view = R.view, framed = { ...R.cam }, fresh = doc.createElement('canvas');
    fresh.className = canvas.className;
    fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
    canvas.replaceWith(fresh); canvas = fresh;
    // the same framing, so the picture carries on rather than jumping
    R = mods.createRenderer(canvas, W, ice, { cam: framed });
    R.view = view; R.glow = glow; rung = 0;
    ice.dirtyAll = true;
  }
  function start() { if (!raf && win) { lastFrame = 0; raf = win.requestAnimationFrame(frame); } }
  function stop() { if (raf && win) win.cancelAnimationFrame(raf); raf = 0; }

  function mount() {
    if (!host || mounted) return;
    mounted = true;
    host.innerHTML = shell();
    addFullscreenButton(host.querySelector('.gdr-rink'), host);
    canvas = host.querySelector('.gdr-canvas');
    host.querySelector('.gdr-glow')?.addEventListener('click', () => { setGlow(!glow); glowSave(win, glow); });
    host.querySelector('.gdr-ink')?.addEventListener('click', () => { setInk(!ink); inkSave(win, ink); });
    host.querySelector('.gdr-gore')?.addEventListener('click', () => { setGore(GORES[(GORES.indexOf(gore) + 1) % GORES.length]); goreSave(win, gore); });
    host.querySelector('.gdr-cam')?.addEventListener('click', () => { setCam(camView === 'vertical' ? 'broadcast' : 'vertical'); camSave(win, camView); });
    const { createIce, createWorld } = mods;
    ice = createIce(doc);
    W = createWorld(ice, 'rinkside');
    W.xrayGore = gore;
    D = createDirector(W, {
      onLand: () => {
        if (!landed) { landed = true; if (last) head(last); }
        reveal();
        // a big save: whose it was, as the booth calls it
        if (last && last.type === 'chance' && last.goalieLine) showL3(statCard(last.goalieLine, true), 5.5, 'save');
      },
      emit: (name, data) => { if (name === 'sfx') _sfx(data.key, data); },
      zamboniLapse: opts.zamboniLapse,
    });
    // the scorer's stat line goes up with his goal's replay and comes down with it (and the
    // frame loop checks again, for a replay that runs out on its own)
    {
      const RP = W.replay, start0 = RP.start, stop0 = RP.stop;
      RP.start = (...a) => { const ok = start0(...a); l3Tick(); return ok; };
      RP.stop = () => { stop0(); l3Tick(); };
    }
    makeRenderer();
    start();
  }

  // The play landed: the held line and any held card go up now.
  function reveal() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (pendingCaption) { const p = pendingCaption; pendingCaption = null; showCaption(p.text); p.speak?.(); }
    if (pendingCard) { const c = pendingCard; pendingCard = null; renderCard(c); }
  }

  // ── live from the Gardens ─────────────────────────────────────────────────
  // The game's first line: the venue's name over the picture, and the establishing shot
  // (gl/approach.js) in over the city and down onto the building on a canvas of its own, which
  // dissolves into the ice, where the men are warming up. With reduced motion, the name alone. The
  // venue comes once a revision (venue.js; the payload's venueRev asked for it), so a first visit
  // may wait a moment for it, and goes without the shot if it doesn't come.
  let fly = null;
  const motionOff = () => doc?.documentElement?.dataset?.motion === 'off' || !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  function arrive(p) {
    landed = true;
    head({ ...p, section: 'PRE-GAME', clock: '' });
    board(null);
    reveal();
    letterArrive(p);
    if (motionOff() || opts.fly === false) return;
    const v = venueOf('hockey');
    if (v?.skyline) { startFly(v); return; }
    const off = onVenue((sport) => { const w = sport === 'hockey' && venueOf('hockey'); if (w?.skyline) { off(); if (last === p) startFly(w); } });
    setTimeout(off, 4000);
  }
  function letterArrive(p) {
    const pic = host?.querySelector('.gdr-rink');
    if (!pic || !p.venue) return;
    pic.querySelector('.gdr-arrive')?.remove();
    const el = doc.createElement('div');
    el.className = `gdr-arrive${p.final ? ' final' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="gdr-arrive-tag"><i></i>LIVE</div><div class="gdr-arrive-from">from</div>` +
      `<div class="gdr-arrive-venue">${_esc(p.venue)}</div>${p.final ? `<div class="gdr-arrive-sub">${_esc(p.final)}</div>` : ''}`;
    pic.appendChild(el);
    const calm = motionOff();
    setTimeout(() => el.classList.add('in'), calm ? 0 : 1500);
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 800); }, calm ? 6000 : 16000);
  }
  function startFly(v) {
    stopFly();
    import('./gl/approach.js').then(({ createApproachRenderer, FLY }) => {
      const pic = host?.querySelector('.gdr-rink');
      if (!pic || fly || last?.type !== 'arrive') return;
      const cv = doc.createElement('canvas');
      cv.className = 'gdr-approach';
      cv.setAttribute('aria-hidden', 'true');
      pic.insertBefore(cv, pic.querySelector('.gdr-hud'));
      const fit = () => { const k = Math.min(win?.devicePixelRatio || 1, 1.5); cv.width = Math.max(1, Math.round(pic.clientWidth * k)); cv.height = Math.max(1, Math.round(pic.clientHeight * k)); };
      fit();
      let R2 = null;
      try { R2 = createApproachRenderer(cv, v); } catch (err) { console.warn('[rink] the fly-in would not build:', err && err.message); }
      if (!R2) { cv.remove(); return; }
      fly = { R: R2, cv, raf: 0, t0: win.performance.now(), at: null };
      const step = (now) => {
        if (!fly || fly.cv !== cv) return;
        // (`at` holds it on one moment, for the sandbox and the gates)
        const t = fly.at != null ? fly.at : (now - fly.t0) / 1000;
        if (cv.width !== Math.round(pic.clientWidth * Math.min(win?.devicePixelRatio || 1, 1.5))) fit();
        if (!R2.render(t)) { stopFly(); return; }
        cv.classList.toggle('out', t > FLY.dur - FLY.fade);
        if (fly.at == null && t > FLY.dur + 0.2) { stopFly(); return; }
        fly.raf = win.requestAnimationFrame(step);
      };
      fly.raf = win.requestAnimationFrame(step);
    }).catch((err) => console.warn('[rink] the fly-in failed to load:', err && err.message));
  }
  function stopFly() {
    if (!fly) return;
    if (fly.raf) win?.cancelAnimationFrame(fly.raf);
    try { fly.R.dispose(); } catch { /* already gone */ }
    fly.cv.remove();
    fly = null;
  }

  const cued = (p) => !!(p && Array.isArray(p.cues) && p.cues.length);
  function apply(p) {
    if (!host || !p) return;
    last = p;
    const go = () => {
      if (last !== p) return;
      mount();
      host.querySelector('.gdr-idle')?.remove();
      if (p.type === 'arrive') { arrive(p); return; }
      stopFly();
      landed = false;
      head(p);
      board(p.type === 'intermission' ? p : null);
      crowdPlay(p);
      if (p.scorerLine) l3Goal = p.scorerLine;
      if (l3Up === 'save') hideL3();
      D.stage(p);
      // A cued payload is the first line of a play the booth calls as it happens, so its
      // line goes up now and the picture follows the lines. Otherwise the line waits for
      // the play to land, and a play that never lands still lets it go up.
      if (holdTimer) clearTimeout(holdTimer);
      if (cued(p)) reveal(); else holdTimer = setTimeout(reveal, 9000);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => console.error('[rink] failed to load:', err));
  }

  function showCaption(text) {
    caption = String(text || '');
    const el = host && host.querySelector('.gdr-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }
  function setCaption(text, o) {
    const speak = o && o.speak;
    if (o && o.held && !(cued(last) && D && D.busy())) {
      if (pendingCaption) { showCaption(pendingCaption.text); pendingCaption.speak?.(); }
      pendingCaption = { text: String(text || ''), speak };
      // the payload may still be on its way; if no play turns up, the line goes up anyway
      if (!(D && D.busy())) { if (holdTimer) clearTimeout(holdTimer); holdTimer = setTimeout(reveal, 1500); }
    } else { showCaption(text); speak?.(); }
  }

  function renderCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    const m = CARD[fx.kind](fx);
    // On the picture, not the whole view: placed against the view it sat over the score
    // line on a phone, where the text takes a bigger share of the box.
    const pic = host.querySelector('.gdr-rink') || host.querySelector('.gdr-wrap') || host;
    let el = host.querySelector('.gdr-jumbo');
    if (!el) { el = doc.createElement('div'); el.className = 'gdr-jumbo'; pic.appendChild(el); }
    el.innerHTML = `<div class="gdr-jumbo-brand">${(m.club && _crest(m.club, 40)) || cphlMark('20px')}</div>` +
      `<div class="gdr-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gdr-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gdr-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  // ── the stat line ─────────────────────────────────────────────────────────
  // A lower third with a man's season on it: up while his goal is run back, and for a few
  // seconds after a big save (the payload's scorerLine and goalieLine, the narrator's). His
  // sweater number and his ratings are the rink's own, off the body wearing his name, so the
  // bars are the skater the viewer has been watching; the numbers are the league's.
  let l3Goal = null, l3Up = null, l3Timer = null;
  const pct = (n, d) => (d > 0 ? n / d : null);
  const r99 = (v) => Math.round(40 + 59 * Math.max(0, Math.min(1, v)));
  function bodyOf(line) {
    if (!W || !D || !last) return null;
    const side = line.team === last.homeTeam ? 'h' : 'a';
    return D.state?.names?.[side]?.get(line.name) || null;
  }
  function statCard(line, goalie) {
    const b = bodyOf(line), side = line.team === last?.homeTeam ? 'h' : 'a';
    const num = goalie ? W?.goalie?.[side]?.num : b?.num;
    const cell = (k, v) => `<span><i>${k}</i>${_esc(String(v))}</span>`;
    let stats, tag = '', bars = '';
    if (goalie) {
      const sv = pct(line.sa - line.ga, line.sa), gaa = line.gp > 0 ? line.ga / line.gp : null;
      stats = cell('GP', line.gp) + cell('W', line.w) + cell('SV%', sv == null ? '—' : sv.toFixed(3).replace(/^0/, '')) + cell('GAA', gaa == null ? '—' : gaa.toFixed(2));
      if (line.tonightSa) tag = `${line.tonightSv} save${line.tonightSv === 1 ? '' : 's'} on ${line.tonightSa} tonight`;
    } else {
      const sh = pct(line.g, line.sog);
      stats = cell('GP', line.gp) + cell('G', line.g) + cell('A', line.a) + cell('PTS', line.pts) + cell('SH%', sh == null ? '—' : (sh * 100).toFixed(1));
      tag = line.tonightG >= 3 ? 'HAT TRICK' : line.tonightG === 2 ? 'His 2nd tonight' : '';
      const rt = b?.rt || ratingsFor(line.name);
      bars = [['SPEED', rt.skate], ['HANDS', rt.hands], ['PASSING', rt.pass], ['CHECKING', rt.check]]
        .map(([k, v]) => `<span><i>${k}</i><b style="--v:${Math.max(0, Math.min(1, v)).toFixed(3)}"></b><em>${r99(v)}</em></span>`).join('');
    }
    return `<div class="gdr-l3-id">${_crest(line.team, 30) || ''}${num ? `<span class="num">${num | 0}</span>` : ''}<span class="nm">${_esc(String(line.name).toUpperCase())}</span>` +
      `<span class="tm">${_esc(line.team || '')}${goalie ? ' · Goaltender' : ''}</span></div>` +
      `<div class="gdr-l3-row"><span class="lbl">This season</span>${stats}${tag ? `<span class="tag">${_esc(tag)}</span>` : ''}</div>` +
      (bars ? `<div class="gdr-l3-bars">${bars}</div>` : '');
  }
  function showL3(html, secs, why) {
    const pic = host?.querySelector('.gdr-rink');
    if (!pic) return;
    let el = pic.querySelector('.gdr-l3');
    if (!el) { el = doc.createElement('div'); el.className = 'gdr-l3'; pic.appendChild(el); }
    el.innerHTML = html; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    l3Up = why;
    if (l3Timer) clearTimeout(l3Timer);
    l3Timer = secs ? setTimeout(hideL3, secs * 1000) : null;
  }
  function hideL3() {
    if (l3Timer) { clearTimeout(l3Timer); l3Timer = null; }
    host?.querySelector('.gdr-l3')?.classList.remove('in');
    l3Up = null;
  }
  // (each frame: the scorer's line goes up with his goal's replay and comes down with it)
  function l3Tick() {
    const on = !!(W && W.replay && W.replay.active && W.replay.kind === 'goal');
    if (on && l3Up !== 'replay' && l3Goal) showL3(statCard(l3Goal, false), 0, 'replay');
    else if (!on && l3Up === 'replay') hideL3();
  }
  function showCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    // the end of the game: the buzzer, as at the end of a period
    if (fx.kind === 'gamewin' && W) _sfx('periodHorn');
    if (D && D.busy() && pendingCaption) pendingCard = fx; else renderCard(fx);
  }
  function clearCard() { if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; } host?.querySelector('.gdr-jumbo')?.remove(); }

  // Opened before a beat arrived: the ice, the men warming up, and the lockup over it.
  function showIdle() {
    if (!host) return;
    clearCard();
    const go = () => {
      mount();
      if (last) head(last);
      if (host.querySelector('.gdr-idle')) return;
      const veil = doc.createElement('div');
      veil.className = 'gdr-idle';
      veil.innerHTML = cphlLockup('Rinkside', '46px') + `<div class="gdr-idle-sub">Waiting for the drop…</div>`;
      // over the ice only, so the pre-game call under it stays readable
      (host.querySelector('.gdr-rink') || host.querySelector('.gdr-wrap'))?.appendChild(veil);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => console.error('[rink] failed to load:', err));
  }

  function clear() {
    stop(); clearCard(); stopFly();
    if (crowdBack) { clearTimeout(crowdBack); crowdBack = null; }
    if (crowd) crowd.stop();
    crowd = null;
    if (offClubs) { offClubs(); offClubs = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    leaveFullscreen(host);
    if (host) host.innerHTML = '';
    mounted = false; canvas = null; W = null; D = null; R = null; ice = null;
    caption = ''; pendingCaption = null; pendingCard = null; last = null;
  }

  return {
    apply, clear, setCaption, showIdle, showCard,
    // for the demo page and the smoke gate
    get world() { return W; }, get director() { return D; }, get renderer() { return R; }, get crowd() { return crowd || null; },
    busy: () => !!(D && D.busy()),
    setSpeed(k) { speed = k; },
    setGlow, get glow() { return glow; },
    // the fly-in, and a moment of it to hold on (seconds in; null runs it)
    get fly() { return fly; }, holdFly(t) { if (fly) fly.at = t; },
    ready: () => loadMods(),
  };
}

// Test hook: the geometry the broadcast regress checks payloads against.
export const __test = { GEO, DOTS, SAVE };
