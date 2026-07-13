// Helm chase view — a spectator camera locked behind the Echelon's REAL flight-sim 3D
// model, watching her make way with a wake astern. It reuses the flight renderer wholesale
// (paintWindshield) rather than re-drawing anything: we hand it a map window centred on the
// yacht (open Basin water + the `mark:'yacht'` cell at the centre, carrying a live `wake`),
// flip on the external orbit camera, and suppress the own-ship aircraft with `hideOwnShip`.
// The yacht cell at window-centre becomes the framed subject; the chase arc gives behind-and-
// above for free. Sailing just spikes the throttle: the wake blooms and the sea rushes, the
// same cues the real sim uses for speed — the Echelon herself is world-fixed bow-north, so she
// doesn't pivot (matching the game), and the chart carries the actual heading.
//
// Public: openHelmChase(containerEl, opts) → controller { sail, setHour, setWeather,
//   setPosition, isSailing, destroy }. opts: { gx, gy, hour, weather, onArrive(gx,gy) }.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield } from './windshield.js';

// Live world clock/weather via the shared (non-flight) env system — loaded OPTIONALLY so a
// standalone/embed context that can't provide it (or fails to load it) still runs on opts
// rather than hard-failing the whole module at import time.
let _getEnvSnapshot = null;
import('./environment.js').then(m => { _getEnvSnapshot = m.getEnvSnapshot; }).catch(() => {});

const RAD = 10;                                   // half-width of the ocean window (tiles)
const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const oceanCell = () => ({ kind: 'land', biome: 'water', road: 0 });   // open sea — flat, no buildings

// The general (non-flight) environment system speaks a slightly wider weather taxonomy than
// the windshield renders; fold the extras onto the tokens it knows.
const WX_MAP = { thunderstorm: 'storm', blizzard: 'snow', overcast: 'cloudy', haze: 'fog', none: 'clear', unknown: 'clear' };
const normalizeWx = (w) => { w = (w || '').toLowerCase(); return WX_MAP[w] || w || 'clear'; };

// Live time + weather straight from the shared world clock/weather (environment.js) — the SAME
// systems the rest of the client uses, nothing flight-specific. Returns null before the first
// server sync (e.g. the standalone test rig), so callers fall back to their opts.
function liveEnv() {
  if (!_getEnvSnapshot) return null;
  try {
    const s = _getEnvSnapshot();
    if (!s || !s.time) return null;
    const [h, m] = s.time.split(':').map(Number);
    return { hour: (h || 0) + (m || 0) / 60, weather: normalizeWx(s.weatherType) };   // fractional hour → smooth dawn/dusk sky
  } catch { return null; }
}

const CARDINAL = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

// A proper (not flat) cloud field, synthesised from the live headline weather so the windshield's
// fly-through volumetric deck has cells to render — clear skies pass null (its procedural fair-
// weather deck stands in). Cells scatter around the yacht within ±R tiles and drift on their own
// velocities (windshield.stepWeatherCells advects them), mirroring the server's field shape.
function buildWxField(weather, cx, cy) {
  const S = {
    cloudy:   { n: 8,  r: [12, 20], i: [0.50, 0.80], type: 'cloud' },
    overcast: { n: 10, r: [16, 26], i: [0.70, 0.95], type: 'cloud' },
    fog:      { n: 6,  r: [14, 22], i: [0.50, 0.78], type: 'cloud' },
    rain:     { n: 8,  r: [14, 22], i: [0.70, 0.95], type: 'cloud', precip: 'rain' },
    storm:    { n: 7,  r: [16, 24], i: [0.85, 1.00], type: 'storm', precip: 'rain' },
    snow:     { n: 8,  r: [14, 22], i: [0.60, 0.90], type: 'cloud', precip: 'snow' },
  }[weather];
  if (!S) return null;
  const R = 70, rand = (a, b) => a + Math.random() * (b - a), cells = [];
  for (let k = 0; k < S.n; k++) cells.push({
    x: cx + rand(-R * 0.8, R * 0.8), y: cy + rand(-R * 0.8, R * 0.8),
    r: rand(S.r[0], S.r[1]), intensity: rand(S.i[0], S.i[1]), type: S.type,
    ...(S.precip ? { precip: S.precip } : {}), vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5),
  });
  return { tick: 30, bounds: { minX: cx - R, maxX: cx + R, minY: cy - R, maxY: cy + R }, cells };
}

// Self-contained boat soundscape — a low diesel rumble (two detuned saws + a sub, through a
// lowpass, pitch + gain riding the throttle) and a filtered-noise water wash that rises as she
// makes way. Its own AudioContext so it needs no game-audio API; lazily created + resumed on the
// first frame after a user gesture, silent at a dead stop.
function makeBoatAudio() {
  let actx = null, master, engGain, washGain, oscs = [], failed = false;
  function ensure() {
    if (actx || failed) return !!actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { failed = true; return false; }
    try {
      actx = new AC();
      master = actx.createGain(); master.gain.value = 0; master.connect(actx.destination);
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 0.7; lp.connect(master);
      engGain = actx.createGain(); engGain.gain.value = 0; engGain.connect(lp);
      for (const [base, g] of [[46, 0.5], [47.6, 0.5], [92, 0.14]]) {
        const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = base;
        const gn = actx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(engGain); o.start();
        oscs.push({ o, base });
      }
      const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = actx.createBufferSource(); ns.buffer = buf; ns.loop = true;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.5;
      washGain = actx.createGain(); washGain.gain.value = 0; ns.connect(bp); bp.connect(washGain); washGain.connect(master); ns.start();
    } catch { failed = true; actx = null; return false; }
    return true;
  }
  return {
    update(spd) {
      if (!ensure()) return;
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      const t = actx.currentTime;
      master.gain.setTargetAtTime(0.5, t, 0.3);
      engGain.gain.setTargetAtTime(0.03 + spd * 0.5, t, 0.15);      // faint idle → throaty under way
      washGain.gain.setTargetAtTime(spd * 0.5, t, 0.15);           // water wash rises with way
      for (const { o, base } of oscs) o.frequency.setTargetAtTime(base * (1 + spd * 0.32), t, 0.25);
    },
    stop() { if (actx) { try { actx.close(); } catch {} actx = null; } },
  };
}

export function openHelmChase(container, opts = {}) {
  ensureWindshieldStyles();
  const id = 'helm-chase-' + Math.random().toString(36).slice(2, 8);
  container.innerHTML = windshieldHTML(id, 'ECHELON · AFT');

  // A static open-water window with the Echelon at its centre. The centre cell carries a live
  // `wake` + `heading` we mutate each frame; every other cell is featureless sea.
  const map = [];
  for (let y = -RAD; y <= RAD; y++) {
    const row = [];
    for (let x = -RAD; x <= RAD; x++) row.push(oceanCell());
    map.push(row);
  }
  const yacht = { kind: 'land', biome: 'water', road: 0, mark: 'yacht', wake: { spd: 0 }, heading: opts.heading ?? 0 };
  map[RAD][RAD] = yacht;

  const st = {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0,
    hour: opts.hour ?? 19, weather: (opts.weather || 'clear').toLowerCase(),
    heading: opts.heading ?? 0, headingTarget: opts.heading ?? 0, turnRate: 16,   // deg/s — a big yacht comes about slowly
    spd: 0, sailing: false, sailT: 0, sailDur: 2.6, sailDir: null,
    // Camera: extYaw/extPitch are the orbit (drag), extZoom the dolly (wheel). The windshield
    // clamps extPitch above the terrain, so the orbit can never dip the eye below the water.
    extYaw: 0, extPitch: opts.extPitch ?? 0.34, extZoom: opts.extZoom ?? 1.7,
    wx: { key: null, field: null },
    onArrive: opts.onArrive || null,
    alive: true, raf: 0, last: performance.now(),
  };
  const audio = makeBoatAudio();

  // Shortest-path ease of heading → headingTarget; returns whether she's still coming round.
  function stepTurn(dt) {
    let d = ((st.headingTarget - st.heading + 540) % 360) - 180;   // −180..180
    const step = st.turnRate * dt;
    if (Math.abs(d) <= step) st.heading = st.headingTarget;
    else st.heading = (st.heading + Math.sign(d) * step + 360) % 360;
    return st.heading !== st.headingTarget;
  }

  function frame(now) {
    if (!st.alive) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;

    stepTurn(dt);

    if (st.sailing) {
      st.sailT += dt / st.sailDur;
      if (st.sailT >= 1) {
        st.sailT = 1; st.sailing = false;
        st.gx += DV[st.sailDir][0]; st.gy += DV[st.sailDir][1];
        if (st.onArrive) st.onArrive(st.gx, st.gy, st.sailDir);
      }
    }
    // Throttle: a bell only while actually making way — at rest she settles to a dead stop, so
    // the wake vanishes (no idle floor). She's under way = there's a wake; moored = flat water.
    const drive = st.sailing ? Math.sin(st.sailT * Math.PI) : 0;
    st.spd += (drive - st.spd) * Math.min(1, dt * 3.2);
    if (st.spd < 0.004) st.spd = 0;
    yacht.wake.spd = st.spd;
    yacht.heading = st.heading;
    audio.update(st.spd);
    st.seaScroll = (st.seaScroll || 0) + st.spd * dt * 6;   // along-heading drift so the swell streams past under way

    // Live time + weather from the shared world (falls back to opts before first sync).
    const env = liveEnv();
    const hour = env ? env.hour : st.hour;
    const weather = env ? env.weather : st.weather;
    if (st.wx.key !== weather) { st.wx.key = weather; st.wx.field = buildWxField(weather, st.gx, st.gy); }

    paintWindshield(id, {
      external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
      heading: st.heading, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: st.extZoom,
      height: 0, speed: st.spd, hour, weather, wxField: st.wx.field, seaScroll: st.seaScroll || 0,
      map, mapCenter: { x: st.gx, y: st.gy }, mapOffset: { x: 0, y: 0 },
      acX: st.gx, acY: st.gy, biomeBelow: 'water', airport: 'default',
    });
    st.raf = requestAnimationFrame(frame);
  }
  st.raf = requestAnimationFrame(frame);

  const busy = () => st.sailing || st.heading !== st.headingTarget;

  return {
    // Turn the wheel: roll the course ±90° to the next cardinal. Locked while she's already coming
    // round or under way — she finishes the turn, then takes the next input. Returns the accepted flag.
    steer(delta) { if (busy()) return false; st.headingTarget = (st.headingTarget + delta + 360) % 360; return true; },
    // Ahead: make way one tile along the current (settled) heading. Returns the compass dir
    // ('N'/'E'/'S'/'W') so the caller can fire the live `sail` command, or false if busy.
    ahead() { if (busy()) return false; const dir = CARDINAL[st.heading]; if (!dir) return false; st.sailing = true; st.sailT = 0; st.sailDir = dir; return dir; },
    heading() { return st.heading; },
    isBusy: busy,
    isSailing() { return st.sailing; },
    env() { return liveEnv(); },   // live world time/weather (or null) for the console chips
    // Orbit the chase camera (drag): azimuth + elevation. Pitch is clamped to a sane band here;
    // the windshield further floors it above the waterline so it never goes under.
    orbit(dYaw, dPitch) { st.extYaw = (st.extYaw + dYaw + 360) % 360; st.extPitch = Math.max(-0.15, Math.min(1.2, st.extPitch + dPitch)); },
    zoom(dz) { st.extZoom = Math.max(0.6, Math.min(2.4, st.extZoom * (1 + dz))); },
    resetView() { st.extYaw = 0; st.extPitch = opts.extPitch ?? 0.34; st.extZoom = opts.extZoom ?? 1.7; },
    // Absolute course (from the wheel): snap the demanded degrees to the nearest cardinal and
    // let her ease there — so she "spins to the direction you spin the wheel to", slowly.
    setCourse(deg) { const c = Math.round(deg / 90) * 90; st.headingTarget = ((c % 360) + 360) % 360; },
    setHour(h) { st.hour = h; },
    setWeather(w) { st.weather = (w || 'clear').toLowerCase(); st.wx.key = null; },
    setPosition(gx, gy) { st.gx = gx; st.gy = gy; },
    setHeading(h) { st.heading = st.headingTarget = ((h % 360) + 360) % 360; },
    setTrim(pitch, zoom) { if (pitch != null) st.extPitch = pitch; if (zoom != null) st.extZoom = zoom; },
    destroy() { st.alive = false; cancelAnimationFrame(st.raf); audio.stop(); disposeWindshield(id); container.innerHTML = ''; },
  };
}
