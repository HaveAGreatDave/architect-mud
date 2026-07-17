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
// All eight rhumbs — she can now make way on the diagonals across open water, not just the cardinals.
const DV = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
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

const CARDINAL = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
// Heading (deg, bow-north = 0) for a tile delta, snapped to the nearest of the eight rhumbs — used
// to swing the bow onto each leg of a charted course as she rounds it.
const heading8 = (dx, dy) => { if (!dx && !dy) return 0; const d = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; return (Math.round(d / 45) * 45) % 360; };
const LOCK_TOL = 6;   // deg — how close to a rhumb the demanded course must be to "click" into the notch (lock)
// Come-about feel: she swings at TURN_BASE by default, but cranking the wheel harder AND keeping it
// going the same way banks a boost (steerBy) that adds to the swing rate, so a vigorous spin brings her
// about faster and resolves the turn sooner; it bleeds off (stepTurn) once you ease, and a reversal
// spools it back down first. Tune by feel.
const TURN_BASE = 16;          // deg/s — her lazy baseline swing (a big yacht comes about slowly)
const TURN_BOOST_MAX = 80;     // deg/s — the most extra rate a hard, sustained same-way crank adds
const TURN_BOOST_GAIN = 2.0;   // boost banked per degree of same-direction wheel input
const TURN_BOOST_DECAY = 46;   // deg/s the boost bleeds off per second once you stop feeding the wheel
const CRUISE = 0.78;   // steady making-way throttle held across a passage (0..1) — drives wake + wash + swell.
                       // Pushed UP so she reads as genuinely UNDERWAY: a boiling wake and a sea that
                       // streams hard past the hull, not a calm creep. Passage DISTANCE is still time-based
                       // (sailT over transitMs), independent of this, so the tile math is unchanged.
// Resting chase pose. The yacht is the SUBJECT, so she's pinned near screen-centre horizontally — a
// yaw twist shows her flank (the "quarter" view) but can't slide her off the centred wheel. The
// strong yaw gives the rear-quarter flank angle; the pitch tips the eye DOWN over her stern so the
// whole hull drops clear of the top edge into the water band — foreground sea in front of her — and
// is never clipped by the console/HUD along the bottom. zoom pulls back so the full hull reads.
const REST = { yaw: 34, pitch: 0.58, zoom: 1.7 };   // high elevated chase — the eye rides well up-and-over her stern looking DOWN onto the deck, so the hull sits in the water band off the horizon, clear of the wheel; the windshield still clamps it above the water so the eye never goes under

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
    heading: opts.heading ?? 0, headingTarget: opts.heading ?? 0, turnRate: TURN_BASE,   // deg/s — a big yacht comes about slowly
    turnBoost: 0, spinDir: 0,   // extra swing rate banked by cranking the wheel + the last spin direction (see steerBy/stepTurn)
    // The wheel steers by DIRECTION (relative), so courseDemand accumulates the demanded course and
    // she makes way only when it clicks into one of the eight rhumb notches. locked/lockedDir latch
    // the notch it's currently seated in (null between notches) — seeded from her opening heading (a
    // persisted rhumb) so she can cast off on her current course without first jiggling the wheel.
    courseDemand: opts.heading ?? 0,
    locked: Math.abs((opts.heading ?? 0) - Math.round((opts.heading ?? 0) / 45) * 45) <= LOCK_TOL,
    lockedDir: CARDINAL[((Math.round((opts.heading ?? 0) / 45) * 45 % 360) + 360) % 360],
    // A passage is a long, sustained transit: she makes way at CRUISE for transitMs, then arrives
    // at the next tile. sailT is 0..1 progress across the passage. spd rides toward the throttle.
    spd: 0, sailing: false, sailT: 0, transitMs: 0, transitEnd: 0, sailDir: null, sailTiles: 1,
    path: null,          // active passage polyline (absolute tiles, path[0] = departure) — a charted course bends; a straight sail is null
    plannedPath: null,   // a previewed-but-not-yet-engaged charted course, for the NAV/map to draw before you throttle up
    cruise: CRUISE,   // the bell's visual way (0..1) — set per-passage by the throttle; drives wake/wash/knots

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

  // Ease heading → headingTarget the SAME rotational way the wheel was turned. Both are tracked
  // UNBOUNDED (they wind past 360 / below 0), so the difference carries the wheel's real direction:
  // spin the wheel right and headingTarget climbs, so she turns right — never the deceptively "short"
  // way round. Callers that only know an absolute bearing (a server passage) rebase the target to the
  // nearest equivalent first, so those still take the short route. Display normalizes with mod 360.
  function stepTurn(dt) {
    // The boost banked by cranking the wheel bleeds off when you stop feeding it, so she coasts back to
    // her lazy baseline swing once the wheel settles. While you keep spinning, it holds the rate up.
    if (st.turnBoost > 0) st.turnBoost = Math.max(0, st.turnBoost - TURN_BOOST_DECAY * dt);
    const d = st.headingTarget - st.heading;
    const step = (st.turnRate + st.turnBoost) * dt;
    if (Math.abs(d) <= step) st.heading = st.headingTarget;
    else st.heading += Math.sign(d) * step;
    return st.heading !== st.headingTarget;
  }
  // The value ≡ deg (mod 360) closest to the current unbounded heading — used to rebase an absolute
  // bearing (server passage / reset) so she still comes about the short way to it.
  const nearestEquiv = (deg) => deg + Math.round((st.heading - deg) / 360) * 360;

  function frame(now) {
    if (!st.alive) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
    // The whole per-frame body is guarded. This loop reschedules itself only at the very END, and the
    // renderer (paintWindshield) has no internal try/catch — so a SINGLE throw anywhere in here (e.g. a
    // transient non-finite coord reaching a canvas gradient, which throws) would never reach the
    // reschedule and would PERMANENTLY freeze the 3D scene, while the separate status poll kept ticking
    // (the "MAKING WAY, ETA counting down, boat frozen at SPEED 0.0" bug — most visible right at
    // throttle-up, when the wake first draws). Catch, log ONCE, and keep animating so the next frame
    // recovers instead of the view bricking.
    try {

    stepTurn(dt);

    if (st.sailing) {
      const total = st.transitMs || 1;
      // Clamp to [0,1]. The Math.max(0,…) is load-bearing, not cosmetic: transitEnd is stamped with
      // performance.now() inside the cast-off event handler, but this frame's `now` is the rAF vsync
      // timestamp, which can read slightly EARLIER — so on the first frame after Get Underway `remaining`
      // exceeds the full passage and sailT would go a hair NEGATIVE. That negative made `f = sailT*segs`
      // negative, `Math.floor(f) = -1`, and `st.path[-1]` undefined → "undefined is not iterable" threw
      // and froze the whole scene (only on cast-off; a reopen has no path branch to index). Floor at 0.
      st.sailT = Math.max(0, Math.min(1, (total - Math.max(0, st.transitEnd - now)) / total));
      if (now >= st.transitEnd) {
        st.sailT = 1; st.sailing = false;
        // With a real streamed world the server re-centres us (setWorld) on arrival — so HOLD the
        // full one-tile lead (she's drawn on the destination cell) until that window swaps in, rather
        // than snapping mapOffset back to 0 and popping her a tile backward. The synthetic fallback
        // (standalone rig, no server) advances our own tile and zeroes the offset to match.
        if (!st.serverWorld) {
          if (st.path) { st.gx = st.path[st.path.length - 1][0]; st.gy = st.path[st.path.length - 1][1]; }
          else { st.gx += DV[st.sailDir][0] * st.sailTiles; st.gy += DV[st.sailDir][1] * st.sailTiles; }
          st.mapOffset.x = 0; st.mapOffset.y = 0; st.center.sub = undefined;
        }
        if (st.onArrive) st.onArrive(st.gx, st.gy, st.sailDir);
      }
    }
    // Throttle: while under way she holds the passage's bell (st.cruise — set by how far the telegraph
    // was pushed), blooming HARD at cast-off and easing off as she comes to rest, so a higher bell reads
    // as a bigger boiling wake + faster water + more knots; moored ⇒ dead flat water. The bloom/settle
    // envelope is keyed to ELAPSED/REMAINING TIME (a fixed ~0.4 s bloom, ~0.8 s settle), NOT the passage
    // FRACTION — so the wake + knots jump up the instant she gets underway even on a long charted course,
    // instead of crawling up over its first 3 % (which read as a boat sitting dead in the water).
    const remMs = st.sailing ? Math.max(0, st.transitEnd - now) : 0;
    const elapMs = (st.transitMs || 1) - remMs;
    const bell = st.sailing ? Math.min(1, elapMs / 400, remMs / 800) : 0;
    const drive = st.cruise * bell;
    st.spd += (drive - st.spd) * Math.min(1, dt * 3.2);
    if (st.spd < 0.004) st.spd = 0;
    // Non-finite guard: spd + heading feed the yacht's WAKE (a canvas radial gradient), and canvas
    // gradients THROW on a non-finite arg — which, in this un-try/caught loop, permanently freezes the
    // 3D scene. `x < 0.004` is false for NaN, so a stray NaN would otherwise stick; snap it back.
    if (!Number.isFinite(st.spd)) st.spd = 0;
    if (!Number.isFinite(st.heading)) st.heading = st.headingTarget = 0;
    if (!st.center.wake) st.center.wake = { spd: 0 };
    st.center.wake.spd = st.spd;
    const hdgN = ((st.heading % 360) + 360) % 360;   // heading winds unbounded; the renderer wants 0..360
    st.center.heading = hdgN;
    audio.update(st.spd);
    // Waves + their crest lighting stay put — they only undulate in place (via the renderer's own time
    // term), never translating with the hull. The old along-heading `seaScroll` drift slid the whole
    // swell (and its specular glint) past like a conveyor belt, which read as fake. The REAL making-way
    // cue is the shoreline/city sliding past her (mapOffset/center.sub below), so the sea itself holds.
    st.seaScroll = 0;
    // Real passage progress: pan the whole world window sub-tile toward the destination (mapOffset)
    // AND lead the yacht cell by the same amount (center.sub) so she holds screen-centre while the
    // city/shoreline slide past her — she visibly crosses the Basin over the ten minutes, not a
    // stationary boat that pops to the next tile. sailT is server-authoritative (see beginTransit),
    // so leaving and reopening the helm resumes exactly where she is. Flat when moored.
    if (st.sailing && st.path && st.path.length >= 2) {
      // A charted (pathfound) course: interpolate her continuous position along the polyline by the
      // passage progress, lead the yacht cell + pan the world by that offset (so she holds screen-
      // centre while the shoreline slides past), and swing the bow onto the current leg's heading.
      const segs = st.path.length - 1;
      const raw = st.sailT * segs;
      const f = Number.isFinite(raw) ? Math.max(0, Math.min(segs, raw)) : 0;   // NaN/out-of-range sailT must never index past the polyline (Math.min/max don't kill NaN, so test first)
      const i = Math.min(segs - 1, Math.floor(f)), local = f - i;
      const a = st.path[i], b = st.path[i + 1], p0 = st.path[0];
      if (a && b && p0) {
        const cx = a[0] + (b[0] - a[0]) * local, cy = a[1] + (b[1] - a[1]) * local;
        const gx = cx - p0[0], gy = cy - p0[1];
        if (Number.isFinite(gx) && Number.isFinite(gy)) { st.mapOffset.x = gx; st.mapOffset.y = gy; st.center.sub = { x: gx, y: gy }; }
        st.headingTarget = nearestEquiv(heading8(b[0] - a[0], b[1] - a[1]));   // ease onto each leg as she rounds the course
      }
    } else if (st.sailing && st.sailDir) {
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
      ? st.contacts.map(c => { const dx = (c.x ?? 0) - st.gx, dy = (c.y ?? 0) - st.gy; return { ...c, dx, dy, ...(c.onGround ? { groundZ: 0, altDiff: 0 } : { altDiff: c.alt || 0 }), rng: Math.hypot(dx, dy) }; })
      : null;

    paintWindshield(id, {
      external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
      heading: hdgN, extYaw: st.extYaw, extPitch: st.extPitch, extZoom: st.extZoom,
      height: 0, speed: st.spd, hour, weather, wxField: field, seaScroll: st.seaScroll || 0, contacts,
      map: st.map, mapCenter: { x: st.gx, y: st.gy }, mapOffset: st.mapOffset,
      acX: st.gx, acY: st.gy, biomeBelow: 'water', airport: 'default',
    });

    } catch (e) {
      if (!st._frameErrLogged) { console.error('[helm] frame render error (view kept alive — report this stack):', e); st._frameErrLogged = true; }
    }
    st.raf = requestAnimationFrame(frame);
  }
  st.raf = requestAnimationFrame(frame);

  const busy = () => st.sailing || st.heading !== st.headingTarget;

  return {
    // Turn the wheel: roll the course ±90° to the next cardinal. Locked while she's already coming
    // round or under way — she finishes the turn, then takes the next input. Returns the accepted flag.
    steer(delta) { if (busy()) return false; st.headingTarget = (st.headingTarget + delta + 360) % 360; return true; },
    // The rhumb she's ready to make way on: the wheel must be locked into a notch AND she must have
    // come round onto it (not still turning / not already under way). null otherwise — the console
    // gates the throttle on this, so you can't go forward until the heading strip lights up.
    readyDir() { if (busy()) return null; return st.locked ? st.lockedDir : null; },
    // The notch the wheel is currently seated in (regardless of whether she's finished turning to it),
    // and the raw demanded bearing — the heading strip lights the locked notch and rides the demand.
    lockedDir() { return st.locked ? st.lockedDir : null; },
    courseDemand() { return st.courseDemand; },
    // Ahead: make way one tile along the current (settled) heading over a short local surge — used
    // only by the standalone rig, which has no server to time the passage. Returns the compass dir.
    ahead() { const dir = this.readyDir(); if (!dir) return false; st.sailDir = dir; st.sailTiles = 1; st.cruise = CRUISE; st.transitMs = 6000; st.transitEnd = performance.now() + 6000; st.sailing = true; st.sailT = 0; return dir; },
    // Begin a real passage: a sustained making-way transit of `ms` along `dir`, arriving one tile
    // on. Snaps her course to the travel heading; frame() eases her there and advances the tile at
    // the end. The server drives this (10-min passage) and confirms arrival via endTransit.
    beginTransit(dir, ms, total, tiles, cruise, path) {
      if (!DV[dir]) return false;
      // A pathfound course (from the map popup) arrives with its absolute tile polyline — glide the
      // bends; a straight `sail` has none. Either way she comes about onto the FIRST leg's heading.
      st.path = (Array.isArray(path) && path.length >= 2) ? path : null;
      st.plannedPath = null;   // the preview is now the live passage
      const firstDeg = st.path ? heading8(st.path[1][0] - st.path[0][0], st.path[1][1] - st.path[0][1]) : DEG[dir];
      st.headingTarget = nearestEquiv(firstDeg); st.sailDir = dir; st.sailTiles = Math.max(1, tiles || 1);   // rebase near current so she comes about the short way to the ordered course
      st.courseDemand = st.headingTarget; st.locked = true; st.lockedDir = CARDINAL[((Math.round(firstDeg / 45) * 45 % 360) + 360) % 360] || dir;   // she's now on the ordered rhumb — resync the demand so wheel deltas resume relative to it (no snap-home)
      if (cruise > 0) st.cruise = Math.max(0.2, Math.min(1.2, cruise));   // the passage's bell (visual way); omitted ⇒ keep the default
      // `ms` = time remaining, `total` = the whole passage (defaults to ms for a fresh cast-off).
      // Seeding transitMs from the total makes sailT reflect TRUE progress, so a helm reopened mid-
      // passage resumes with the world already part-slid rather than snapping back to the start.
      st.transitMs = total || ms; st.transitEnd = performance.now() + ms; st.sailing = true;
      st.sailT = Math.max(0, Math.min(1, (st.transitMs - ms) / st.transitMs));
      return true;
    },
    cruise() { return st.cruise; },
    // Authoritative arrival from the server: snap to her real tile and release the passage. Idempotent
    // with frame()'s own local arrival (both just end the passage + fix position).
    endTransit(gx, gy) { st.sailing = false; st.transitEnd = 0; st.path = null; st.mapOffset.x = 0; st.mapOffset.y = 0; st.center.sub = undefined; if (gx != null) st.gx = gx; if (gy != null) st.gy = gy; },
    // A previewed charted course (absolute tiles) the map popup drew but hasn't engaged yet, so the
    // NAV scope + popup can trace it; cleared once she gets underway or you cancel. Null = no plan.
    setPlannedCourse(path) { st.plannedPath = (Array.isArray(path) && path.length >= 2) ? path : null; },
    plannedCourse() { return st.plannedPath; },
    transitLeft() { return st.sailing ? Math.max(0, st.transitEnd - performance.now()) : 0; },
    speed() { return st.spd; },
    heading() { return st.heading; },
    // Top-down chart snapshot for the console's NAV map — the live world window (piers/shoreline/
    // open water) centred on the yacht, plus her tile, heading and passage lead so the blip glides.
    mapSnapshot() { return { rows: st.map, gx: st.gx, gy: st.gy, heading: st.heading, sub: st.center && st.center.sub || null, sailing: st.sailing, plannedPath: st.plannedPath, path: st.path }; },
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
    // Orbit the chase camera (drag): azimuth ONLY — a fixed-elevation turntable that sweeps around her
    // in a dome at the lowest sea-level angle, holding her centred and high on screen. Elevation is
    // pinned (no vertical lift), so you can spin all the way around but never tilt the eye up or down.
    orbit(dYaw) { st.extYaw = (st.extYaw + dYaw + 360) % 360; },
    zoom(dz) { st.extZoom = Math.max(0.6, Math.min(2.4, st.extZoom * (1 + dz))); },
    resetView() { st.extYaw = opts.extYaw ?? REST.yaw; st.extPitch = st.restPitch; st.extZoom = opts.extZoom ?? REST.zoom; },
    // Resting elevation, driven by the console from the visible water band: a cramped view (panel up)
    // pitches DOWN (top-down) so the whole hull reads in the short band; a roomy view (fullscreen)
    // eases toward a level near-horizon chase. The ship is kept centred by the canvas itself sizing to
    // the band, so this only sets the ANGLE, not her screen position. Adopts it live unless mid-orbit.
    setRestPitch(p) { const was = st.restPitch; st.restPitch = p; if (Math.abs(st.extPitch - was) < 1e-3) st.extPitch = p; },
    // Steer by the wheel's spin (RELATIVE): `deg` is the signed change in demanded course this frame
    // (+ = right/CW, − = left/CCW). It accumulates onto courseDemand — kept UNBOUNDED so the heading
    // climbs/falls the same way the wheel turned — and she eases toward it, EXCEPT within LOCK_TOL of
    // one of the eight rhumbs, where the course "clicks" into that notch (locked) and she settles
    // exactly on it. Between notches she sits off-cardinal, locked is false, and the throttle stays
    // gated (readyDir null) until you seat the wheel in a notch. Being incremental, the wheel never
    // re-asserts a stale absolute bearing after a passage — the fix for her snapping home.
    steerBy(deg) {
      st.courseDemand += deg;
      // Cranking harder — and keeping the wheel going the SAME way — spools her turn up: bank the spin
      // magnitude into turnBoost (stepTurn adds it to the swing rate), so a vigorous same-direction crank
      // brings her about quicker. Reversing the wheel spools the boost back down first.
      if (deg) {
        const dir = Math.sign(deg);
        if (dir !== st.spinDir) { st.turnBoost = 0; st.spinDir = dir; }
        st.turnBoost = Math.min(TURN_BOOST_MAX, st.turnBoost + Math.abs(deg) * TURN_BOOST_GAIN);
      }
      const notch = Math.round(st.courseDemand / 45) * 45;   // nearest rhumb, unbounded
      const off = Math.abs(st.courseDemand - notch);         // 0..22.5
      if (off <= LOCK_TOL) { st.locked = true; st.lockedDir = CARDINAL[((notch % 360) + 360) % 360]; st.headingTarget = notch; }
      else { st.locked = false; st.lockedDir = null; st.headingTarget = st.courseDemand; }
    },
    setHour(h) { st.hour = h; },
    setWeather(w) { st.weather = (w || 'clear').toLowerCase(); st.wx.key = null; },
    setPosition(gx, gy) { st.gx = gx; st.gy = gy; },
    setHeading(h) {
      st.heading = st.headingTarget = st.courseDemand = ((h % 360) + 360) % 360;   // resync the demand so the wheel steers relative to her real heading
      const notch = Math.round(st.courseDemand / 45) * 45;
      st.locked = Math.abs(st.courseDemand - notch) <= LOCK_TOL;
      st.lockedDir = st.locked ? CARDINAL[((notch % 360) + 360) % 360] : null;
    },
    setTrim(pitch, zoom) { if (pitch != null) st.extPitch = pitch; if (zoom != null) st.extZoom = zoom; },
    // Live camera tuning handle (dev): read / set the whole resting chase pose at once, so the
    // framing can be dialled in from the console and the winning numbers baked into REST.
    pose() { return { yaw: +st.extYaw.toFixed(1), pitch: +st.extPitch.toFixed(3), zoom: +st.extZoom.toFixed(3) }; },
    setPose(p = {}) { if (p.yaw != null) st.extYaw = ((p.yaw % 360) + 360) % 360; if (p.pitch != null) st.extPitch = p.pitch; if (p.zoom != null) st.extZoom = p.zoom; return this.pose(); },
    destroy() { st.alive = false; cancelAnimationFrame(st.raf); audio.stop(); disposeWindshield(id); container.innerHTML = ''; },
  };
}
