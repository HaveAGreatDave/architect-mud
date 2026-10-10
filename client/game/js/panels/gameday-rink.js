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
import { GEO, DOTS } from './rink/geo.js';
import { DT } from './rink/rig.js';
import { SAVE, createDirector } from './rink/director.js';

function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// The CPhL soundset (client/shared/hockey-sfx.js) is procedural and preset-addressed, so
// the rink names the EVENT and the soundset owns what it sounds like. Silent if the file or
// AudioEngine isn't there: most of the audience is reading text.
const SFX = {
  shot: 'hk-puck-slap', chest: 'hk-check', pad: 'hk-pad-save', glove: 'hk-glove-save',
  post: 'hk-post', wide: 'hk-glass', block: 'hk-stick-hit', poke: 'hk-stick-hit', stick: 'hk-stick-hit',
  boards: 'hk-puck-tick', glass: 'hk-glass', shatter: 'hk-glass', stop: 'hk-skate-stop',
  net: 'hk-net', horn: 'hk-goal-horn', periodHorn: 'hk-period-horn',
  drop: 'hk-puck-tick', sweep: 'hk-skate-scrape', whistle: 'hk-whistle', receive: 'hk-puck-tick',
  punch: 'hk-punch', punchMiss: 'hk-punch-miss', gloves: 'hk-gloves-drop',
  check: 'hk-check', fall: 'hk-check', sever: 'hk-check',
  roar: 'hk-crowd-roar', gasp: 'hk-crowd-gasp', groan: 'hk-crowd-groan',
};
// how often one sound may repeat, so ten men stopping at once isn't ten scrapes
const SFX_GAP = { stop: 0.35, boards: 0.12, receive: 0.2, drop: 0.2, check: 0.15, fall: 0.25, punch: 0.08, glass: 0.15 };

// Jumbotron cards: the same sportsfx graphics tv.js would take the whole screen with,
// rendered compact over the rink so the ice stays visible.
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

export function createRinkView(host, opts = {}) {
  const doc = host ? host.ownerDocument : null;
  const win = doc ? doc.defaultView : null;
  let caption = '', pendingCaption = null, pendingCard = null, cardTimer = null, holdTimer = null;
  let last = null, raf = 0, lastFrame = 0, acc = 0, mounted = false, speed = opts.speed || 1;
  let W = null, D = null, R = null, ice = null, canvas = null, modsP = null, mods = null;
  const sfxAt = {};
  let costAvg = 0;

  // The ./rink modules load on first mount, so tv.js's import of this file stays cheap.
  function loadMods() {
    return (modsP ??= Promise.all([import('./rink/textures.js'), import('./rink/sim.js'), import('./rink/render.js'), import('./gl/arena.js')])
      .then(([t, s, r, a]) => (mods = { createIce: t.createIce, createWorld: s.createWorld, createRenderer: r.createRenderer, createArenaRenderer: a.createArenaRenderer })));
  }

  function _sfx(key, o) {
    const id = SFX[key];
    if (!id || !W) return;
    const gap = SFX_GAP[key] || 0.03;
    if (W.t - (sfxAt[key] ?? -9) < gap) return;
    sfxAt[key] = W.t;
    const seed = o && o.seed != null ? o.seed : ((W.t * 1000) | 0);
    const def = win?.SFXCatalog?.get?.(id);
    if (def && win?.HockeySfx?.variant && win?.AudioEngine?.playSfx) { win.AudioEngine.playSfx(win.HockeySfx.variant(def, seed)); }
    else if (def && win?.AudioEngine?.playSfx) win.AudioEngine.playSfx(def);
    else win?.HockeySfx?.play?.(id, seed);
    // the crowd answers a moment later
    if (key === 'horn') W.schedule(0.22, () => _sfx('roar'));
    if (key === 'post') W.schedule(0.18, () => _sfx('gasp'));
  }

  function shell() {
    return `<div class="gdr-wrap">` +
      `<div class="gdr-head"></div>` +
      `<div class="gdr-rink"><canvas class="gdr-canvas" aria-label="Rinkside: the play on the ice"></canvas><canvas class="gdr-hud" aria-hidden="true"></canvas></div>` +
      `<div class="gdr-strip"></div>` +
      `<div class="gdr-rush" hidden></div>` +
      `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
    `</div>`;
  }
  function head(p) {
    const el = host?.querySelector('.gdr-head'); if (!el) return;
    el.innerHTML =
      `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
      `<span class="gdr-head-score">${_esc(p.awayAbbr || p.awayTeam || 'AWY')} <b>${p.awayScore | 0}</b>: <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || p.homeTeam || 'HOM')}</span>` +
      `<span class="gdr-head-clock">${p.type === 'intermission' ? 'INTERMISSION' : `${_esc(p.section || '')} ${_esc(p.clock || '')}`}</span>` +
      (p.rivalry ? '<span class="gdr-head-rival">RIVALRY</span>' : '') +
      (p.strength && p.strength !== 'even' && p.type !== 'intermission' ? `<span class="gdr-head-str ${_esc(p.strength)}">${_esc(p.strength.toUpperCase())}</span>` : '');
    const st = host.querySelector('.gdr-strip');
    if (st) st.innerHTML = p.type === 'intermission' ? '' :
      `<span class="gdr-strip-desc">${_esc(p.desc || '')}</span>` +
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
          `<span class="a">${g.assist ? `from ${_esc(g.assist)}` : 'unassisted'}</span><span class="c">${_esc(g.teamName || '')}</span>` +
          (g.strength && g.strength !== 'even' ? `<span class="s">${_esc(String(g.strength).toUpperCase())}</span>` : '') + `</div>`).join('')
      : `<div class="gdri-none">No goals in the ${_esc(p.section || 'period')}.</div>`;
    const cas = (p.casualties || []).length ? `<div class="gdri-cas">Carried off: ${(p.casualties || []).map(_esc).join(', ')}. No replacements.</div>` : '';
    const stand = Array.isArray(p.standings) && p.standings.length
      ? `<div class="gdri-stand"><div class="gdri-stand-head">CPhL · PTS</div>` + p.standings.slice(0, 6).map((r, i) =>
          `<div class="gdri-stand-row${r.team === p.awayTeam || r.team === p.homeTeam ? ' me' : ''}"><span class="r">${i + 1}</span><span class="t">${_esc(r.team)}</span><span class="p">${r.points ?? 0}</span></div>`).join('') + `</div>` : '';
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
    const real = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    let dt = real * speed;
    if (W.hitstop > 0) { W.hitstop -= real; dt *= 0.3; }
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 24) { W.step(DT); acc -= DT; n++; }
    if (n === 24) acc = 0;
    if (R.lost) fallback();
    R.render(now);
    govern(real);
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
    if (opts.camera) R.view = opts.camera;
  }
  // A lost WebGL context doesn't come back as a 2-D one: the canvas is replaced, and the
  // 2-D renderer carries on with the same world and camera framing.
  function fallback() {
    const view = R.view, fresh = doc.createElement('canvas');
    fresh.className = canvas.className;
    fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
    canvas.replaceWith(fresh); canvas = fresh;
    R = mods.createRenderer(canvas, W, ice);
    R.view = view; rung = 0;
    ice.dirtyAll = true;
  }
  function start() { if (!raf && win) { lastFrame = 0; raf = win.requestAnimationFrame(frame); } }
  function stop() { if (raf && win) win.cancelAnimationFrame(raf); raf = 0; }

  function mount() {
    if (!host || mounted) return;
    mounted = true;
    host.innerHTML = shell();
    canvas = host.querySelector('.gdr-canvas');
    const { createIce, createWorld } = mods;
    ice = createIce(doc);
    W = createWorld(ice, 'rinkside');
    D = createDirector(W, {
      onLand: reveal,
      emit: (name, data) => { if (name === 'sfx') _sfx(data.key, data); },
      zamboniSpeed: opts.zamboniSpeed,
    });
    makeRenderer();
    start();
  }

  // The play landed: the held line and any held card go up now.
  function reveal() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (pendingCaption) { const p = pendingCaption; pendingCaption = null; showCaption(p.text); p.speak?.(); }
    if (pendingCard) { const c = pendingCard; pendingCard = null; renderCard(c); }
  }

  const cued = (p) => !!(p && Array.isArray(p.cues) && p.cues.length);
  function apply(p) {
    if (!host || !p) return;
    last = p;
    const go = () => {
      if (last !== p) return;
      mount();
      host.querySelector('.gdr-idle')?.remove();
      head(p);
      board(p.type === 'intermission' ? p : null);
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
    const wrap = host.querySelector('.gdr-wrap') || host;
    let el = host.querySelector('.gdr-jumbo');
    if (!el) { el = doc.createElement('div'); el.className = 'gdr-jumbo'; wrap.appendChild(el); }
    el.innerHTML = `<div class="gdr-jumbo-brand">${cphlMark('20px')}</div>` +
      `<div class="gdr-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gdr-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gdr-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  function showCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
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
      host.querySelector('.gdr-wrap')?.appendChild(veil);
    };
    if (mods) go(); else loadMods().then(go).catch((err) => console.error('[rink] failed to load:', err));
  }

  function clear() {
    stop(); clearCard();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (host) host.innerHTML = '';
    mounted = false; canvas = null; W = null; D = null; R = null; ice = null;
    caption = ''; pendingCaption = null; pendingCard = null; last = null;
  }

  return {
    apply, clear, setCaption, showIdle, showCard,
    // for the demo page and the smoke gate
    get world() { return W; }, get director() { return D; }, get renderer() { return R; },
    busy: () => !!(D && D.busy()),
    setSpeed(k) { speed = k; },
    ready: () => loadMods(),
  };
}

// Test hook: the geometry the broadcast regress checks payloads against.
export const __test = { GEO, DOTS, SAVE };
