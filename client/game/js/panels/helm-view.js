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
const DEG = { N: 0, E: 90, S: 180, W: 270 };
const CRUISE = 0.40;   // steady making-way throttle held across a passage (0..1) — drives wake + wash + swell.
                       // Kept LOW so a big hull's water churn reads calm; passage DISTANCE is time-based
                       // (sailT), independent of this, so she still crosses her tiles in 90s regardless.
// Resting chase pose. The yacht is the SUBJECT, so she's pinned near screen-centre horizontally — a
// yaw twist shows her flank (the "quarter" view) but can't slide her off the centred wheel. The
// strong yaw gives the rear-quarter flank angle; the pitch tips the eye DOWN over her stern so the
// whole hull drops clear of the top edge into the water band — foreground sea in front of her — and
// is never clipped by the console/HUD along the bottom. zoom pulls back so the full hull reads.
const REST = { yaw: 34, pitch: 0.30, zoom: 1.7 };

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

  // Fallback window: a static open-water grid with the Echelon at its centre (for the standalone
  // rig / before the server streams the real basin). In game, setWorld swaps in the REAL world
  // window — piers, shoreline, the city skyline — so she's framed against the actual basin. Either
  // way the centre cell carries a live `wake` + `heading` we mutate each frame.
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
    map, center: yacht, serverWorld: false,   // center = the yacht cell we overlay wake/heading onto
    hour: opts.hour ?? 19, weather: (opts.weather || 'clear').toLowerCase(),
    heading: opts.heading ?? 0, headingTarget: opts.heading ?? 0, turnRate: 16,   // deg/s — a big yacht comes about slowly
    // A passage is a long, sustained transit: she makes way at CRUISE for transitMs, then arrives
    // at the next tile. sailT is 0..1 progress across the passage. spd rides toward the throttle.
    spd: 0, sailing: false, sailT: 0, transitMs: 0, transitEnd: 0, sailDir: null, sailTiles: 1,
    mapOffset: { x: 0, y: 0 },   // sub-tile world pan across a passage (yacht held centred by center.sub)
    serverField: null,   // the REAL weather field from the sim (setSky) — preferred over the synth
    contacts: [],        // airborne craft near the Echelon (absolute x,y), streamed by the server
    // Camera: extYaw/extPitch are the orbit (drag), extZoom the dolly (wheel). The windshield
    // clamps extPitch above the terrain, so the orbit can never dip the eye below the water.
    // Resting pose is a QUARTER-DOWN chase — offset off her stern quarter (extYaw) so she frames
    // clear of the dead-centre wheel, looking down-and-over (extPitch) so the whole hull reads on
    // the water rather than silhouetted on the horizon behind the binnacle.
    extYaw: opts.extYaw ?? REST.yaw, extPitch: opts.extPitch ?? REST.pitch, extZoom: opts.extZoom ?? REST.zoom,
    restPitch: opts.extPitch ?? REST.pitch,   // resting elevation — the console re-tunes this by panel size (setRestPitch)
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
      const total = st.transitMs || 1;
      st.sailT = Math.min(1, (total - Math.max(0, st.transitEnd - now)) / total);
      if (now >= st.transitEnd) {
        st.sailT = 1; st.sailing = false;
        // With a real streamed world the server re-centres us (setWorld) on arrival — so HOLD the
        // full one-tile lead (she's drawn on the destination cell) until that window swaps in, rather
        // than snapping mapOffset back to 0 and popping her a tile backward. The synthetic fallback
        // (standalone rig, no server) advances our own tile and zeroes the offset to match.
        if (!st.serverWorld) { st.gx += DV[st.sailDir][0] * st.sailTiles; st.gy += DV[st.sailDir][1] * st.sailTiles; st.mapOffset.x = 0; st.mapOffset.y = 0; st.center.sub = undefined; }
        if (st.onArrive) st.onArrive(st.gx, st.gy, st.sailDir);
      }
    }
    // Throttle: while under way she holds a steady CRUISE bell (ramped in at cast-off and out as she
    // comes to rest) so there's a sustained wake across the whole passage; moored ⇒ dead flat water.
    const drive = st.sailing ? CRUISE * Math.min(1, st.sailT / 0.03, (1 - st.sailT) / 0.03) : 0;
    st.spd += (drive - st.spd) * Math.min(1, dt * 3.2);
    if (st.spd < 0.004) st.spd = 0;
    if (!st.center.wake) st.center.wake = { spd: 0 };
    st.center.wake.spd = st.spd;
    st.center.heading = st.heading;
    audio.update(st.spd);
    st.seaScroll = (st.seaScroll || 0) + st.spd * dt * 4;   // along-heading drift so the swell streams past under way (gentle — she's a slow, heavy hull)
    // Real passage progress: pan the whole world window sub-tile toward the destination (mapOffset)
    // AND lead the yacht cell by the same amount (center.sub) so she holds screen-centre while the
    // city/shoreline slide past her — she visibly crosses the Basin over the ten minutes, not a
    // stationary boat that pops to the next tile. sailT is server-authoritative (see beginTransit),
    // so leaving and reopening the helm resumes exactly where she is. Flat when moored.
    if (st.sailing && st.sailDir) {
      const gx = DV[st.sailDir][0] * st.sailT * st.sailTiles, gy = DV[st.sailDir][1] * st.sailT * st.sailTiles;
      st.mapOffset.x = gx; st.mapOffset.y = gy;
      st.center.sub = { x: gx, y: gy };
    }

    // Live time + weather from the shared world (falls back to opts before first sync).
    const env = liveEnv();
    const hour = env ? env.hour : st.hour;
    const weather = env ? env.weather : st.weather;
    // Prefer the REAL sim weather field (setSky), so the helm renders the same moving clouds/rain
    // at their true bearings as the flight sim does. Only synth a field when none was streamed
    // (e.g. the standalone rig), so it never falls back to a flat sky.
    let field;
    if (st.serverField) field = st.serverField;
    else { if (st.wx.key !== weather) { st.wx.key = weather; st.wx.field = buildWxField(weather, st.gx, st.gy); } field = st.wx.field; }

    // Planes over the Basin: convert each contact's absolute tile to an offset from the yacht (the
    // same dx/dy the flight sim hands the windshield) so drawContacts frames them around her.
    const contacts = st.contacts.length
      ? st.contacts.map(c => { const dx = (c.x ?? 0) - st.gx, dy = (c.y ?? 0) - st.gy; return { ...c, dx, dy, altDiff: c.alt || 0, rng: Math.hypot(dx, dy) }; })
      : null;

    paintWindshield(id, {
      external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
      heading: st.heading, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: st.extZoom,
      height: 0, speed: st.spd, hour, weather, wxField: field, seaScroll: st.seaScroll || 0, contacts,
      map: st.map, mapCenter: { x: st.gx, y: st.gy }, mapOffset: st.mapOffset,
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
    // The cardinal she's ready to make way on (settled on a cardinal heading, not already busy),
    // or null. The console gates the throttle on this.
    readyDir() { if (busy()) return null; return CARDINAL[st.heading] || null; },
    // Ahead: make way one tile along the current (settled) heading over a short local surge — used
    // only by the standalone rig, which has no server to time the passage. Returns the compass dir.
    ahead() { const dir = this.readyDir(); if (!dir) return false; st.sailDir = dir; st.sailTiles = 1; st.transitMs = 6000; st.transitEnd = performance.now() + 6000; st.sailing = true; st.sailT = 0; return dir; },
    // Begin a real passage: a sustained making-way transit of `ms` along `dir`, arriving one tile
    // on. Snaps her course to the travel heading; frame() eases her there and advances the tile at
    // the end. The server drives this (10-min passage) and confirms arrival via endTransit.
    beginTransit(dir, ms, total, tiles) {
      if (!DV[dir]) return false;
      st.headingTarget = DEG[dir]; st.sailDir = dir; st.sailTiles = Math.max(1, tiles || 1);
      // `ms` = time remaining, `total` = the whole passage (defaults to ms for a fresh cast-off).
      // Seeding transitMs from the total makes sailT reflect TRUE progress, so a helm reopened mid-
      // passage resumes with the world already part-slid rather than snapping back to the start.
      st.transitMs = total || ms; st.transitEnd = performance.now() + ms; st.sailing = true;
      st.sailT = Math.max(0, Math.min(1, (st.transitMs - ms) / st.transitMs));
      return true;
    },
    // Authoritative arrival from the server: snap to her real tile and release the passage. Idempotent
    // with frame()'s own local arrival (both just end the passage + fix position).
    endTransit(gx, gy) { st.sailing = false; st.transitEnd = 0; st.mapOffset.x = 0; st.mapOffset.y = 0; st.center.sub = undefined; if (gx != null) st.gx = gx; if (gy != null) st.gy = gy; },
    transitLeft() { return st.sailing ? Math.max(0, st.transitEnd - performance.now()) : 0; },
    speed() { return st.spd; },
    heading() { return st.heading; },
    // Top-down chart snapshot for the console's NAV map — the live world window (piers/shoreline/
    // open water) centred on the yacht, plus her tile, heading and passage lead so the blip glides.
    mapSnapshot() { return { rows: st.map, gx: st.gx, gy: st.gy, heading: st.heading, sub: st.center && st.center.sub || null, sailing: st.sailing }; },
    isBusy: busy,
    isSailing() { return st.sailing; },
    // Adopt the live sim sky (setSky): the REAL weather field + optional time/weather headline, so
    // the helm shows the same weather the flight sim does. Streamed by the server while open.
    setSky(sky) {
      if (!sky) return;
      st.serverField = sky.field || null;
      if (typeof sky.hour === 'number') st.hour = sky.hour;
      if (sky.weather) st.weather = String(sky.weather).toLowerCase();
    },
    // Airborne craft near the Echelon (absolute tiles), streamed ~2s; the frame reprojects them.
    setContacts(list) { st.contacts = Array.isArray(list) ? list : []; },
    // Swap in the REAL world window (piers/city/shoreline) centred on her tile (cx,cy), streamed by
    // the server. The centre cell becomes the yacht we overlay wake/heading on; `self` cleared so
    // her 3D model draws. Marks us server-driven, so arrivals re-centre from the server, not locally.
    setWorld(rows, cx, cy) {
      if (!Array.isArray(rows) || !rows.length) return;
      const r = (rows.length - 1) >> 1;
      const c = rows[r] && rows[r][r];
      if (!c) return;
      c.self = undefined; if (!c.mark) c.mark = 'yacht'; if (!c.wake) c.wake = { spd: st.spd };
      c.sub = undefined;   // fresh window is centred on her tile — no residual sub-tile lead
      st.map = rows; st.center = c; st.serverWorld = true;
      st.mapOffset.x = 0; st.mapOffset.y = 0;
      if (cx != null) st.gx = cx; if (cy != null) st.gy = cy;
    },
    env() { return liveEnv(); },   // live world time/weather (or null) for the console chips
    // Orbit the chase camera (drag): azimuth + elevation. Pitch is clamped to a sane band here;
    // the windshield further floors it above the waterline so it never goes under.
    orbit(dYaw, dPitch) { st.extYaw = (st.extYaw + dYaw + 360) % 360; st.extPitch = Math.max(-0.15, Math.min(1.2, st.extPitch + dPitch)); },
    zoom(dz) { st.extZoom = Math.max(0.6, Math.min(2.4, st.extZoom * (1 + dz))); },
    resetView() { st.extYaw = opts.extYaw ?? REST.yaw; st.extPitch = st.restPitch; st.extZoom = opts.extZoom ?? REST.zoom; },
    // Resting elevation, driven by the console from the visible water band: a cramped view (panel up)
    // pitches DOWN (top-down) so the whole hull reads in the short band; a roomy view (fullscreen)
    // eases toward a level near-horizon chase. The ship is kept centred by the canvas itself sizing to
    // the band, so this only sets the ANGLE, not her screen position. Adopts it live unless mid-orbit.
    setRestPitch(p) { const was = st.restPitch; st.restPitch = p; if (Math.abs(st.extPitch - was) < 1e-3) st.extPitch = p; },
    // Absolute course (from the wheel): snap the demanded degrees to the nearest cardinal and
    // let her ease there — so she "spins to the direction you spin the wheel to", slowly.
    setCourse(deg) { const c = Math.round(deg / 90) * 90; st.headingTarget = ((c % 360) + 360) % 360; },
    setHour(h) { st.hour = h; },
    setWeather(w) { st.weather = (w || 'clear').toLowerCase(); st.wx.key = null; },
    setPosition(gx, gy) { st.gx = gx; st.gy = gy; },
    setHeading(h) { st.heading = st.headingTarget = ((h % 360) + 360) % 360; },
    setTrim(pitch, zoom) { if (pitch != null) st.extPitch = pitch; if (zoom != null) st.extZoom = zoom; },
    // Live camera tuning handle (dev): read / set the whole resting chase pose at once, so the
    // framing can be dialled in from the console and the winning numbers baked into REST.
    pose() { return { yaw: +st.extYaw.toFixed(1), pitch: +st.extPitch.toFixed(3), zoom: +st.extZoom.toFixed(3) }; },
    setPose(p = {}) { if (p.yaw != null) st.extYaw = ((p.yaw % 360) + 360) % 360; if (p.pitch != null) st.extPitch = p.pitch; if (p.zoom != null) st.extZoom = p.zoom; return this.pose(); },
    destroy() { st.alive = false; cancelAnimationFrame(st.raf); audio.stop(); disposeWindshield(id); container.innerHTML = ''; },
  };
}
