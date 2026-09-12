// ── DRUG FX, CLIENT SIDE ─────────────────────────────────────────────────────
//
// One `drug_fx` message in; three surfaces out. This module is the composer —
// it holds what every live source wants and hands each surface a single answer,
// because two drugs in one body is the normal case and neither of them should
// win outright.
//
//   screen   THIS FILE. CSS over the whole client: the only surface that can
//            warp the TEXT and the UI — blur, ghosted duplicates, letter crawl,
//            a vignette that closes over everything rather than over one pane.
//   field    environment.js → weather-fx.js. Strictly additive particles/haze
//            over the room pane; it is an overlay and cannot distort what is
//            under it.
//   window   flight-drugfx.js. The only surface that can bend the 3-D world out
//            of a windscreen, and only while you are in a seat.
//
// ⚠ ONE OWNER PER ELEMENT, and that is a fix rather than a preference. `#main`
// was already contested — `.tripping`, `.unhinged` and `.insane` each declared
// their own `transform` + `filter` on it, a CSS animation beats an inline style,
// and the last rule in the sheet wins outright, so any two of them live at once
// meant one silently did nothing. So symptoms resolve to AMPLITUDES here and the
// stylesheet carries one rule per element, in which a symptom that is not live
// contributes a zero rather than a competing declaration.
//
// Motion sensitivity is honoured in the STYLESHEET, once, for all ten symptoms —
// both the OS query and the app's own `data-motion` switch. Nothing here checks.

import { SCREEN_FX, PALETTES } from '../../../shared/drug-fx.js';
import { setDrugFieldFx } from './environment.js';
import { setDrugFx as setWindowFx, clearDrugFx as clearWindowFx } from './flight-drugfx.js';

// source ('drug:<id>' | 'intox' | 'trip') -> { screen[], field, fieldIntensity, profile, intensity, palette }
const _sources = new Map();

/**
 * Declare (or replace) one source's FX. `fx` null clears that source.
 *
 * Sources COMPOSE rather than replace: being drunk while tripping is two live
 * sources and you get both, which is the correct answer and the reason this is a
 * map. Screen symptoms union; field, window profile and intensity take the
 * STRONGEST source, because a canvas can only draw one field and a windscreen
 * can only be bent one way.
 */
export function applyDrugFx(source, fx) {
  if (!source) return;
  if (!fx) _sources.delete(source);
  else _sources.set(source, {
    screen: (fx.screen || []).filter(s => SCREEN_FX.includes(s)),
    field: fx.field || null,
    fieldIntensity: clamp01(fx.fieldIntensity ?? fx.intensity),
    profile: fx.profile || null,
    intensity: clamp01(fx.intensity),
    palette: fx.palette || null,
  });
  flush();
}

export function clearDrugFx(source) {
  if (source == null) _sources.clear(); else _sources.delete(source);
  flush();
}

const clamp01 = (v) => { const n = Number(v); return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n; };

/** What is live right now. Pure over the source map — the part worth pinning. */
export function composeDrugFx() {
  const screen = new Set();
  let intensity = 0, palette = null, field = null, fieldIntensity = 0;
  // ⚠ The window profile carries its OWN running maximum rather than riding the
  // overall one. A source can want a screen symptom and no windscreen warp, and
  // reading `profile` off whichever source happened to be strongest overall then
  // answers null while a weaker source is still asking for one.
  let profile = null, profileAt = -1;
  for (const fx of _sources.values()) {
    for (const s of fx.screen) screen.add(s);
    if (fx.intensity > intensity) { intensity = fx.intensity; palette = fx.palette || palette; }
    if (fx.field && fx.fieldIntensity > fieldIntensity) { field = fx.field; fieldIntensity = fx.fieldIntensity; }
    if (fx.profile && fx.intensity > profileAt) { profile = fx.profile; profileAt = fx.intensity; }
  }
  return { screen: [...screen], intensity, palette, field, fieldIntensity, profile };
}

// The one window source, so the flight layer sees a composed answer rather than
// a race between two drugs. `intox` keeps its own key there because the drunk
// meter is a level stream rather than a phase and clears on its own clock.
const WINDOW_KEY = 'drug';

function flush() {
  const c = composeDrugFx();
  applyScreen(c);
  setDrugFieldFx(c.field ? { effect: c.field, intensity: c.fieldIntensity } : null);
  if (c.profile && c.intensity > 0) setWindowFx(WINDOW_KEY, c.profile, c.intensity);
  else clearWindowFx(WINDOW_KEY);
}

const AMPLITUDES = ['--dfx-sway', '--dfx-breathe', '--dfx-blur', '--dfx-jitter',
                    '--dfx-double', '--dfx-melt', '--dfx-halo', '--dfx-sat', '--dfx-con', '--dfx-hue'];

function applyScreen({ screen, intensity, palette }) {
  if (typeof document === 'undefined') return;
  const body = document.body, root = document.documentElement;

  for (const name of SCREEN_FX) body.classList.toggle(`dfx-${name}`, screen.includes(name));
  body.classList.toggle('dfx-on', screen.length > 0 && intensity > 0);

  if (!screen.length || intensity <= 0) {
    document.getElementById('dfx-tunnel')?.remove();
    // ⚠ Take the amplitudes back to rest as well as dropping the classes. The
    // rule reads them through var() defaults, but a property left on :root is
    // inherited by the NEXT effect that only sets some of them — a stimulant
    // handing its jitter to the opiate that follows it.
    for (const p of AMPLITUDES) root.style.removeProperty(p);
    root.style.removeProperty('--dfx-i');
    return;
  }

  root.style.setProperty('--dfx-i', intensity.toFixed(3));
  if (palette && palette in PALETTES) root.style.setProperty('--dfx-hue', String(PALETTES[palette]));

  const on = (n) => (screen.includes(n) ? 1 : 0);
  root.style.setProperty('--dfx-sway', String(on('sway')));
  root.style.setProperty('--dfx-breathe', String(on('breathe')));
  root.style.setProperty('--dfx-blur', String(on('blur')));
  root.style.setProperty('--dfx-jitter', String(on('jitter')));
  root.style.setProperty('--dfx-double', String(on('double')));
  root.style.setProperty('--dfx-melt', String(on('melt')));
  root.style.setProperty('--dfx-halo', String(on('halo')));
  // ⚠ Saturation is the one pair that can be asked for in both directions at
  // once — a psychedelic's `oversat` under a dissociative's `desat`. Resolved to
  // a single number here rather than left to two rules taking turns, and the
  // downer wins, because that is what the mixture actually does to you.
  const sat = on('desat') ? 1 - 0.6 * intensity : on('oversat') ? 1 + 1.1 * intensity : 1;
  root.style.setProperty('--dfx-sat', sat.toFixed(3));
  root.style.setProperty('--dfx-con',
    (on('oversat') ? 1 + 0.25 * intensity : on('desat') ? 1 + 0.12 * intensity : 1).toFixed(3));

  if (screen.includes('narrow')) ensureTunnel();
  else document.getElementById('dfx-tunnel')?.remove();
}

// Tunnel vision gets its own fixed element rather than a filter on `#main`,
// because a vignette that swayed and scaled with the view would stop reading as
// the edge of your own sight and start reading as a picture frame coming loose.
function ensureTunnel() {
  if (document.getElementById('dfx-tunnel')) return;
  const el = document.createElement('div');
  el.id = 'dfx-tunnel';
  document.body.appendChild(el);
}

// Exposed for the smoke suite only (the `_test` convention). The composition law
// is the part worth pinning and it is pure.
export const _test = {
  composeDrugFx,
  set: (s, fx) => { if (!fx) _sources.delete(s); else _sources.set(s, { screen: fx.screen || [], field: fx.field || null, fieldIntensity: clamp01(fx.fieldIntensity ?? fx.intensity), profile: fx.profile || null, intensity: clamp01(fx.intensity), palette: fx.palette || null }); },
  reset: () => _sources.clear(),
};
