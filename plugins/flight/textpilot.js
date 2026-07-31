// Text-native piloting — flying an aircraft by typed command, with the SERVER
// running the physics instead of a 60fps WebGL cockpit.
//
// The counterpart to textmode.js (which is the passenger half). Same one player
// preference governs both: set Flight Display to "Text only" and you never see a canvas,
// whether you're riding or flying.
//
// THE KEY FACT that makes this cheap: `flight-model.js` is a pure, DOM-free module.
// It is already stepped headless by the regress suite and four tuning harnesses, so
// there is no port — the same physics the 3D client runs, run here. What the client
// normally does (integrate at 60fps, report via `flightsync`, and let `reconcile`
// clamp the result) the server does for itself, which means there is nothing to
// distrust and none of reconcile's anti-spoof clamping applies.
//
// ASSISTED, NOT RAW. The model was tuned for continuous stick input; a player typing
// a command every second or two has nowhere near that authority, and exposing
// `elevator 0.3` would make stalls and approaches punishing for the wrong reason. So
// a text pilot sets INTENT — `climb to 3000`, `turn to heading 090` — and the
// autopilot below flies the surfaces toward it. Same physics, different hands.
//
// It ticks the AIRCRAFT, not the player, on its own 1s schedule — deliberately not
// the `registerActivity` posture sweep, because posture only becomes 'flying' at
// wheels-up (cmdFlightEvent's takeoff branch) and a text pilot has to be simulated
// through startup, taxi and the takeoff roll before that ever happens. `runupTick`
// in index.js is the existing precedent for a 1s sweep over `liveAircraft`.
//
// Takeoff and landing REUSE `cmdFlightEvent` rather than reimplementing it. That
// handler already owns the whole consequence chain — posture, parking, contract
// delivery, checkride grading, landing IP, detaching everyone — and it was only ever
// "client-driven" in the sense that the client decided WHEN to call it and computed
// the landing grade. Here the server decides and computes both, from its own state.

import { schedule } from '../../server/engine/scheduler.js';
import {
  liveAircraft, getLivePlayer, sendToPlayer, getZone, isContinuous, effStats,
  bandFromAltitude, surfacesWire, toDeg, degToCardinal, setHeading, bounds,
  registerTextPilotTeardown, contextPayload,
} from './state.js';
import { TYPES as FM_TYPES, createState as fmCreate, step as fmStep, readout as fmReadout } from '../../client/game/js/panels/flight-model.js';
import { checkGateProximity, checkrideEvent, evaluateCheckride } from './checkride.js';

const TICK_S = 1;          // the sweep's own cadence
const SUBSTEPS = 10;       // fmStep calls per tick — the model is tuned for small dt
const SUB_DT = TICK_S / SUBSTEPS;

// World pace. The flight model owns airspeed and heading but not map position, so
// the tile rate has to come from somewhere. It comes from the CHARTER autopilot's
// pace (charter.js: CRUISE_TILES 0.45 tiles per 2.5s tick at cruise power), because
// that is the existing SERVER-side answer to "how fast does an aircraft cross the
// map" and it's what other pilots already see NPC-flown craft do. Anchoring to the
// 3D client's own figure instead would mean reverse-engineering a render-space
// constant that exists to make the scenery look right, not to measure the world.
const TILES_PER_SEC_AT_CRUISE = 0.45 / 2.5;

// Landing grade by sink rate at contact. Ported from the cockpit's report card
// (client/game/js/panels/cockpit.js LANDING_GRADES) so a text landing is graded on
// exactly the same curve as a flown one — the checkride's PASS_GRADES and the
// LANDING_IP table both key off these letters, so they must not drift.
const LANDING_GRADES = [
  [60, 'A+'], [120, 'A'], [180, 'A-'], [250, 'B+'], [330, 'B'], [420, 'B-'],
  [510, 'C+'], [600, 'C'], [680, 'C-'], [750, 'D'], [800, 'F-'],
];
export function landingGrade(fpm) {
  for (const [lim, g] of LANDING_GRADES) if (fpm <= lim) return g;
  return 'F-';
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fmTypeOf = (live) => FM_TYPES[String(live.type?.id || '').replace(/^ac_/, '')] || null;

export function isTextPilot(live) { return !!live?.textPilot; }

// ── Start / stop ──────────────────────────────────────────────────────────────

export function startTextPilot(player, live) {
  const p = fmTypeOf(live);
  if (!p) return false;   // no physics profile for this airframe — caller falls back to the 3D sim
  // The panel mounts in the same top pane the room description uses; `cockpit_close`
  // (which the landing/disembark flow already sends) is what hands it back.
  sendToPlayer(player.id, { type: 'text_cockpit_open', craft: live.type.name });
  live.textPilot = true;
  live.fmState = fmCreate(p);
  live.fmState.heading = toDeg(live.row.heading) || 0;
  live.textTargets = { throttle: live.row.throttle || 0, altitude: null, heading: null, flaps: 0, gear: 1 };
  live._textPrevVs = 0;
  player.textPilot = true;
  // Paint the instruments at once rather than making the pilot wait on the 1s sweep —
  // and the sweep skips a cold parked aircraft entirely, so this is the first frame.
  const first = panelPayload(live);
  if (first) sendToPlayer(player.id, first);
  return true;
}

export function stopTextPilot(live) {
  if (!live) return;
  delete live.textPilot; delete live.fmState; delete live.textTargets;
  delete live._textPrevVs; delete live._textContactVs; delete live._textStatusCtr;
}
registerTextPilotTeardown(stopTextPilot);   // `detach` clears the aircraft-side sim with the seat

// ── Status readout — the text pilot's instrument panel ─────────────────────────

export function statusLines(live) {
  const s = live.fmState, p = fmTypeOf(live);
  if (!s || !p) return 'No instruments.';
  const r = fmReadout(s, p);
  const cap = effStats(live).fuelCap || 1;
  const fuelPct = Math.round((live.row.fuel / cap) * 100);
  const t = live.textTargets || {};
  const bits = [
    `<span class="text-cyan">ALT</span> ${r.altitude}ft${t.altitude != null ? ` <span class="text-dim">→${t.altitude}</span>` : ''}`,
    `<span class="text-cyan">IAS</span> ${r.airspeed}kt`,
    `<span class="text-cyan">HDG</span> ${String(r.heading).padStart(3, '0')}° ${degToCardinal(r.heading).toUpperCase()}`,
    `<span class="text-cyan">VS</span> ${r.vs > 0 ? '+' : ''}${r.vs}fpm`,
    `<span class="text-cyan">THR</span> ${Math.round(live.row.throttle)}%`,
    `<span class="text-cyan">FUEL</span> ${fuelPct}%`,
  ];
  let line = bits.join(' · ');
  if (r.stalled) line += '\n<span class="text-red">⚠ STALLED — nose down, power up.</span>';
  else if (r.stallMargin < 0.25) line += '\n<span class="text-amber">⚠ Buffet — she\'s getting slow.</span>';
  if (fuelPct <= 15) line += '\n<span class="text-amber">⚠ Low fuel.</span>';
  if (s.onGround) line += '\n<span class="text-dim">On the ground.</span>';
  return line;
}

// ── The live panel ────────────────────────────────────────────────────────────
// The instrument pane a text pilot flies by, refreshed every tick. It is DATA only —
// the client draws it as an ASCII/monospace panel (no canvas anywhere in the path).
// Most of it is lifted straight off `contextPayload`, the same payload that feeds the
// 3D cockpit, which is the point: one source of truth for "what's around the plane",
// two ways of drawing it.
export function panelPayload(live) {
  const s = live.fmState, p = fmTypeOf(live);
  if (!s || !p) return null;
  const ctx = contextPayload(live);
  const r = fmReadout(s, p);
  const t = live.textTargets || {};
  return {
    type: 'text_cockpit',
    craft: live.type.name,
    tail: String(live.row.name || '').toUpperCase(),
    alt: r.altitude, ias: r.airspeed, hdg: r.heading, vs: r.vs,
    pitch: r.pitch, bank: r.bank,
    throttle: Math.round(live.row.throttle || 0),
    vr: p.vr, vs0: p.vs0, vne: p.vne,
    stalled: r.stalled, stallMargin: r.stallMargin,
    onGround: r.onGround, airborne: !!live.row.airborne,
    gear: t.gear ? 1 : 0, flaps: Math.round(t.flaps || 0),
    tgtAlt: t.altitude ?? null, tgtHdg: t.heading ?? null,
    fuel: ctx.fuel, fuelCap: ctx.fuelCap, fuelPct: ctx.fuelPct, warn: ctx.warn,
    hull: ctx.hull, surfaces: ctx.surfaces,
    surface: ctx.surface, onField: ctx.onField,
    minimap: ctx.minimap, fields: ctx.fields,
    x: live.row.grid_x, y: live.row.grid_y,
    checkride: ctx.checkride,
  };
}

// ── The autopilot: intent → control surfaces ──────────────────────────────────
// This IS the "assisted" layer. Each call returns one frame of stick for the model.
// Deliberately simple proportional control — it only has to fly better than someone
// typing, not better than a pilot.
function controlsFor(live, p) {
  const s = live.fmState, t = live.textTargets;
  const input = {
    throttle: clamp((t.throttle || 0) / 100, 0, 1),
    flaps: clamp((t.flaps || 0) / 100, 0, 1),
    gear: t.gear ? 1 : 0,
    dmgSurf: surfacesWire(live.row),
    elevator: 0, aileron: 0, pedal: 0,
  };

  // STALL RECOVERY OUTRANKS EVERYTHING. A commanded climb that the wing can't hold is
  // the single most likely way a text pilot dies, and they have no stick to catch it
  // with — so the assist unloads and powers up on its own. It's the same drill a real
  // pilot flies, executed at 10Hz instead of at typing speed.
  if (s.stalled) {
    input.elevator = -0.7;
    input.throttle = 1;
    return input;
  }

  if (s.onGround) {
    // Takeoff roll: hold the nosewheel straight and rotate once she's alive. Below
    // that we're taxiing, so no back pressure at all.
    if (t.takeoff && s.airspeed >= p.vr * 0.92) input.elevator = 0.65;
    if (t.heading != null) input.pedal = clamp(headingError(s.heading, t.heading) / 30, -1, 1);
    return input;
  }

  // Altitude: error → a target climb rate → elevator to chase that rate. Going
  // through vs rather than straight from altitude error is what stops it porpoising.
  if (t.altitude != null) {
    const err = t.altitude - s.altitude;
    const wantVs = clamp(err * 2.2, -1200, 1400);
    input.elevator = clamp((wantVs - s.vs) / 1600, -0.85, 0.85);
  }
  // Heading: error → a target bank → aileron to chase that bank.
  if (t.heading != null) {
    const err = headingError(s.heading, t.heading);
    const wantBank = clamp(err * 1.6, -28, 28);
    input.aileron = clamp((wantBank - s.bank) / 22, -0.9, 0.9);
  } else {
    input.aileron = clamp(-s.bank / 22, -0.6, 0.6);   // no heading held → roll wings level
  }
  return input;
}

// Signed shortest-arc heading error in degrees (+ = turn right).
function headingError(from, to) { return ((to - from + 540) % 360) - 180; }

// ── The tick ──────────────────────────────────────────────────────────────────

async function stepOne(live) {
  const p = fmTypeOf(live);
  const s = live.fmState;
  if (!p || !s) return;

  let contactVs = live._textPrevVs || 0;
  const eff = effStats(live);
  const cruiseKt = Math.max(1, eff.cruise || p.cruise || 84);
  const b = bounds();

  for (let i = 0; i < SUBSTEPS; i++) {
    const input = controlsFor(live, p);
    if (!s.onGround) contactVs = s.vs;   // latch the sink rate BEFORE contact zeroes it
    fmStep(s, input, p, SUB_DT);
    // Advance the map position along the heading at a speed-proportional tile rate.
    if (s.airspeed > 0.5) {
      const tiles = (s.airspeed / cruiseKt) * TILES_PER_SEC_AT_CRUISE * SUB_DT;
      const hr = s.heading * Math.PI / 180;
      live.fx = clamp((live.fx ?? live.row.grid_x) + Math.sin(hr) * tiles, b.minx, b.maxx);
      live.fy = clamp((live.fy ?? live.row.grid_y) - Math.cos(hr) * tiles, b.miny, b.maxy);
    }
  }
  live._textPrevVs = s.vs;
  live._textContactVs = contactVs;   // the sink rate she arrived at, for the landing grade

  // Write the shared contract every other system reads. Same seven `live.cont` fields
  // `reconcile` produces, so hazards, combat, air-to-air contacts and the checkride
  // evaluator can't tell a text-flown craft from a client-flown one.
  live.row.grid_x = Math.round(live.fx); live.row.grid_y = Math.round(live.fy);
  live.row.heading = String(Math.round(s.heading));
  live.row.throttle = Math.round(clamp(live.textTargets.throttle || 0, 0, 100));
  live.row.altitude_band = bandFromAltitude(s.altitude, s.onGround);
  live.cont = {
    altitude: s.altitude, airspeed: s.airspeed, vs: s.vs,
    bank: s.bank, pitch: s.pitch, onGround: s.onGround, stalled: s.stalled,
  };
  live.lastSync = Date.now();   // the unattended-recovery clock — she IS attended, by us
}

// Wheels-up / touchdown edges, routed through the SAME handler the 3D client calls,
// so every consequence (posture, parking, cargo delivery, checkride, IP) is shared.
async function handleEdges(live, contactVs) {
  const s = live.fmState;
  const pilot = live.pilotId ? getLivePlayer(live.pilotId) : null;
  if (!pilot || !_flightEvent) return;
  const bcast = _broadcast || (() => {});

  if (!s.onGround && !live.row.airborne) {
    await _flightEvent(['takeoff'], 'flightevent takeoff', pilot, bcast);
    return;
  }
  if (s.onGround && live.row.airborne) {
    const fpm = Math.round(Math.abs(Math.min(0, contactVs)));
    const grade = landingGrade(fpm);
    await _flightEvent(['land', grade, String(fpm), String(live.fx), String(live.fy)],
      'flightevent land', pilot, bcast);
  }
}

// index.js injects its own `cmdFlightEvent` + a zone broadcaster here at load. Done by
// injection rather than import because index.js already imports this module — a static
// import back the other way would be a cycle.
let _flightEvent = null, _broadcast = null;
export function wireTextPilot({ flightEvent, broadcast }) { _flightEvent = flightEvent; _broadcast = broadcast; }

let ticking = false;
export async function textPilotTick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const live of [...liveAircraft.values()]) {
      if (!live.textPilot || !live.fmState) continue;
      // Cold and parked — nothing to SIMULATE, but the panel still has to paint, or a
      // pilot who boards an engine-off aircraft sits on the "instruments coming alive…"
      // placeholder forever with no way to see (or reach) the throttle.
      if (!live.row.engine_on && live.fmState.onGround && live.fmState.airspeed < 0.5) {
        if (live.pilotId) {
          const idle = panelPayload(live);
          if (idle) sendToPlayer(live.pilotId, idle);
        }
        continue;
      }
      await stepOne(live);
      // The wheels and the DB flag disagreeing IS the edge: flying with airborne unset
      // means she just rotated, on the ground with it still set means she just arrived.
      if (!live.fmState.onGround !== !!live.row.airborne) {
        await handleEdges(live, live._textContactVs || 0);
      }
      // Checkride, flown in text: the same stage machine, driven off the server's own
      // position instead of the cockpit's self-reports.
      if (live.checkride) {
        evaluateCheckride(live);
        if (checkGateProximity(live)) {
          const pilot = live.pilotId ? getLivePlayer(live.pilotId) : null;
          await checkrideEvent(live, 'gate', [null, live.checkride.gateIdx], pilot);
        }
      }
      // The live panel, every tick — this is the instrument pane, so it refreshes at
      // the sim's own rate rather than being narrated into the scroll.
      if (live.pilotId) {
        const panel = panelPayload(live);
        if (panel) sendToPlayer(live.pilotId, panel);
      }
    }
  } finally { ticking = false; }
}
schedule('1s', () => textPilotTick().catch(e => console.error('[flight] text-pilot tick error:', e.message)));

// ── Commands ──────────────────────────────────────────────────────────────────
// All of these only ever set INTENT on live.textTargets — the tick flies it. That's
// the same held-value shape `cmdThrottle`/`cmdHeading` already use for the banded
// craft: a one-shot verb writes a field, a later tick reads it repeatedly.

function requireTextPilot(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || player.seat !== 'pilot') return { err: { type: 'emote', message: "You're not in the pilot's seat." } };
  if (!live.textPilot) return { err: null, live: null };   // a 3D pilot — caller falls through to its own handling
  return { live };
}

export function cmdTextThrottle(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n)) return { type: 'emote', message: 'Throttle to what? <b>throttle 0</b>–<b>throttle 100</b>.' };
  live.textTargets.throttle = clamp(n, 0, 100);
  return { type: 'emote', message: `Throttle set to ${live.textTargets.throttle}%.` };
}

export function cmdTextClimb(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  if (!live.row.airborne) return { type: 'emote', message: 'Fly her off the ground first — <b>takeoff</b>.' };
  const n = parseInt(String(args.join(' ')).replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return { type: 'emote', message: 'Climb to what height? <b>climb to 3000</b>.' };
  live.textTargets.altitude = clamp(n, 0, 20000);
  const dir = live.textTargets.altitude > (live.fmState?.altitude || 0) ? 'ease the nose up' : 'let her down';
  return { type: 'emote', message: `<span class="text-cyan">You ${dir} for ${live.textTargets.altitude}ft.</span>` };
}

export function cmdTextLevel(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  if (!live.row.airborne) return { type: 'emote', message: "You're on the ground." };
  live.textTargets.altitude = Math.round(live.fmState?.altitude || 0);
  return { type: 'emote', message: `<span class="text-cyan">Levelling off at ${live.textTargets.altitude}ft.</span>` };
}

export function cmdTextTurn(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  const s = live.fmState;
  const txt = args.join(' ').toLowerCase().replace(/^to\s+/, '').replace(/^heading\s+/, '');
  const rel = txt.match(/^(left|right|port|starboard)\s*(\d{1,3})?$/);
  let deg;
  if (rel) {
    const amount = rel[2] ? parseInt(rel[2], 10) : 30;
    const sign = /left|port/.test(rel[1]) ? -1 : 1;
    deg = ((Math.round(s.heading) + sign * amount) % 360 + 360) % 360;
  } else if (/^\d{1,3}$/.test(txt)) {
    deg = ((parseInt(txt, 10) % 360) + 360) % 360;
  } else return { type: 'emote', message: 'Turn where? <b>turn to heading 090</b>, or <b>turn left 30</b>.' };
  live.textTargets.heading = deg;
  setHeading(live, deg);
  return { type: 'emote', message: `Coming around to <b>${String(deg).padStart(3, '0')}°</b> (${degToCardinal(deg).toUpperCase()}).` };
}

export function cmdTextFlaps(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n)) return { type: 'emote', message: 'Flaps to what? <b>flaps 0</b>–<b>flaps 100</b>.' };
  live.textTargets.flaps = clamp(n, 0, 100);
  return { type: 'emote', message: `Flaps ${live.textTargets.flaps}%.` };
}

export function cmdTextGear(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  const up = /^(up|in|retract)$/i.test(args[0] || '');
  live.textTargets.gear = up ? 0 : 1;
  return { type: 'emote', message: up ? 'Gear up — she cleans up and accelerates.' : 'Gear down and locked.' };
}

export function cmdTextStatus(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  return { type: 'output', message: statusLines(live) };
}

// `takeoff` for a text pilot is a real command again (the 3D cockpit does it with the
// yoke): it arms the rotation the autopilot flies, and asks for the power to do it.
export function cmdTextTakeoff(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  if (live.row.airborne) return { type: 'emote', message: "You're already flying." };
  if (!live.row.engine_on) return { type: 'emote', message: 'The engine is cold — <b>startup</b> first.' };
  live.textTargets.takeoff = true;
  if ((live.textTargets.throttle || 0) < 90) live.textTargets.throttle = 100;
  live.textTargets.altitude = null;
  return { type: 'emote', message: '<span class="text-green">Full power — she gathers herself and rolls. Hold on; she\'ll fly herself off.</span>' };
}

// `land` sets an approach: gear down, flaps out, and a descent toward the deck. The
// touchdown itself is the physics arriving, graded on the sink rate like any landing.
export function cmdTextLand(args, player) {
  const { live, err } = requireTextPilot(player); if (err) return err; if (!live) return null;
  if (!live.row.airborne) return { type: 'emote', message: "You're already on the ground." };
  live.textTargets.gear = 1;
  live.textTargets.flaps = 100;
  live.textTargets.altitude = 0;
  live.textTargets.takeoff = false;
  if ((live.textTargets.throttle || 0) > 35) live.textTargets.throttle = 30;
  return { type: 'emote', message: '<span class="text-cyan">Gear down, flaps out, power back — you set up the approach and start down.</span> <span class="text-dim">Watch your sink rate; a soft touchdown grades better.</span>' };
}

export const _test = { landingGrade, headingError, controlsFor, fmTypeOf, TILES_PER_SEC_AT_CRUISE };
