// Flight checkride — the pilot licence tutorial + skills test, flown in a free
// loaner Mayfly. A hard gate: without the licence you can't take the pilot seat of
// ANY aircraft (see the boardFound gate in index.js). The examiner NPC at Coldwater
// Regional dispatches START_CHECKRIDE, which conjures the loaner and calls
// beginCheckride here; this module then runs a per-player stage state machine driven
// off the live cockpit telemetry (evaluateCheckride from cmdFlightSync) and the
// discrete cockpit transitions (checkrideEvent from cmdFlightEvent), pushing scripted
// instruction toasts + ring gates to the cockpit through the flight_ctx payload.
//
// The licence is one player_flag (air_pilot_licensed) — the same shape as the
// air-freight licence in contracts.js, but a distinct flag (freight = cargo-work
// unlock; pilot = flying qualification). Ride progress is transient in-memory state;
// a crash or blown maneuver just restarts, no credit penalty (the loaner is free).

import { on } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { pushContext, out } from './state.js';

// The licence flag. Admins/devs are auto-rated (they can still run `.checkride` to
// test the flow — see cmdCheckride in index.js).
const PILOT_LICENSE_FLAG = 'air_pilot_licensed';

export async function isPilotLicensed(player) {
  if (!player) return false;
  if (['admin', 'dev'].includes(player.role)) return true;
  const v = await getFlag('player', PILOT_LICENSE_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

// ── Stages ────────────────────────────────────────────────────────────────────
const STAGE = { STARTUP: 0, TAKEOFF: 1, RINGS: 2, LAND: 3 };

// The pilot-wings ring course over Coldwater Regional (ramp at grid 925,903, runway
// N/S — north is decreasing grid_y). gx/gy are absolute world tiles, alt is feet,
// r is the horizontal pass radius (tiles) and altTol the vertical window (ft). Placed
// to teach a full circuit: climb out straight, bank right, come around, ease down onto
// final. Tolerances are deliberately generous — this is a tutorial.
const GATES = [
  { gx: 925, gy: 888, alt: 1500, r: 6, altTol: 500 },  // climb out, level at 1500
  { gx: 940, gy: 884, alt: 1500, r: 6, altTol: 500 },  // bank right
  { gx: 942, gy: 906, alt: 1100, r: 6, altTol: 500 },  // come around, start down
  { gx: 925, gy: 920, alt: 600,  r: 6, altTol: 450 },  // line up on final from the south
];

const LANDING_FIELD = 'zone_district_925_903';
const PASS_GRADES = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-']);

// The per-stage instruction cards. These stay up on-screen for the whole stage (the
// cockpit renders them as a persistent guidance panel, not a fleeting toast), so each
// one is a full "how to fly this bit" brief. The inverted yoke (drag DOWN = pull back =
// climb) is grounded in the real cockpit.js mapping.
const INSTRUCTIONS = {
  [STAGE.STARTUP]: 'Controls check: the THROTTLE is A (add) / Z (cut). The YOKE is your mouse — drag left/right to bank, ' +
    'and she\'s inverted like a real control column: drag DOWN to pull back and CLIMB, up to descend. ' +
    'To begin, flip the glowing ENGINE master (⏻).',
  [STAGE.TAKEOFF]: 'Push the THROTTLE up to full (A). As the speed tape comes alive and she gets light on her wheels, ' +
    'drag the YOKE DOWN to rotate — nose up — and fly her off the runway. Keep the wings level as you climb away.',
  [STAGE.RINGS]:   'Fly the circuit through the glowing rings in order. Climb to the first, bank into the turns with the ' +
    'YOKE, then ease the nose down toward the last. Watch the altitude tape — each ring has a target height.',
  [STAGE.LAND]:    'Bring her home to Coldwater Regional. Line up on the runway from the south, ease the THROTTLE back (Z) ' +
    'to bleed off speed, and hold a gentle descent on the YOKE. Set her down soft — Grade B or better to pass.',
};

// Human-readable stage label + which cockpit control(s) the client should spotlight for
// each stage (keys map to DOM ids in cockpit.js: engine → #fsim-eng, throttle → #fsim-thr,
// yoke → #fsim-yoke). The card and the glow together keep the player oriented.
const STAGE_NAME = {
  [STAGE.STARTUP]: 'STARTUP', [STAGE.TAKEOFF]: 'TAKEOFF', [STAGE.RINGS]: 'CLIMB & TURNS', [STAGE.LAND]: 'LANDING',
};
const HIGHLIGHT = {
  [STAGE.STARTUP]: ['engine'], [STAGE.TAKEOFF]: ['throttle', 'yoke'], [STAGE.RINGS]: ['yoke'], [STAGE.LAND]: ['throttle', 'yoke'],
};
const STAGE_TOTAL = 4;

// pid -> ride state. Transient; the licence flag is the only persisted result.
const checkrides = new Map();

export function getCheckrideState(pid) { return checkrides.get(pid) || null; }
export function hasActiveCheckride(pid) { return checkrides.has(pid); }

// The slice of state pushed to the cockpit each tick (via contextPayload, which reads
// live.checkride.clientView). Rings are only sent during the RINGS stage so the client
// doesn't draw them early.
function syncState(live, state) {
  state.clientView = {
    stage: state.stage,
    stageName: STAGE_NAME[state.stage],
    stageNum: state.stage + 1,
    stageTotal: STAGE_TOTAL,
    highlight: HIGHLIGHT[state.stage] || [],
    instruction: state.instruction,
    gates: state.stage === STAGE.RINGS ? state.gates : [],
    gateIdx: state.gateIdx,
  };
  if (live) { live.checkride = state; pushContext(live); }
}

function advanceTo(live, state, stage) {
  state.stage = stage;
  state.instruction = INSTRUCTIONS[stage];
  syncState(live, state);   // pushContext now so the new toast fires this frame, not up to a tick later
}

// Initialize a ride on an already-spawned loaner the player is seated in as pilot
// (the spawn lives in index.js, where sendFlightSim is). Called from startCheckrideRide.
export function beginCheckride(player, live) {
  const state = {
    pid: player.id,
    loanerId: live.row.id,
    stage: STAGE.STARTUP,
    gates: GATES.map(g => ({ ...g })),
    gateIdx: 0,
    instruction: INSTRUCTIONS[STAGE.STARTUP],
  };
  checkrides.set(player.id, state);
  syncState(live, state);
}

// Per-frame evaluator — called from cmdFlightSync right after reconcile writes
// live.cont. A cheap early return when there's no active ride. The ring stage passes
// on client-reported `gate` events (checkrideEvent), so this only needs to confirm the
// takeoff→rings transition as a safety net if the discrete takeoff event was missed.
export function evaluateCheckride(live) {
  const state = live.checkride;
  if (!state) return;
  const c = live.cont;
  if (!c) return;
  if (state.stage === STAGE.TAKEOFF && live.row.airborne && !c.onGround && c.altitude > 80) {
    advanceTo(live, state, STAGE.RINGS);
  }
}

// Discrete transitions — called from cmdFlightEvent's engineon/takeoff/gate/land
// branches. Returns true only for a PASSED landing, telling index.js to delete the
// loaner after the normal land flow detaches the pilot.
export async function checkrideEvent(live, ev, args, player) {
  const state = live.checkride;
  if (!state) return false;

  if (ev === 'engineon' && state.stage === STAGE.STARTUP) {
    advanceTo(live, state, STAGE.TAKEOFF);
    return false;
  }

  if (ev === 'takeoff' && (state.stage === STAGE.STARTUP || state.stage === STAGE.TAKEOFF)) {
    advanceTo(live, state, STAGE.RINGS);
    return false;
  }

  if (ev === 'gate' && state.stage === STAGE.RINGS) {
    const idx = Number(args[1]);
    if (idx === state.gateIdx) {
      state.gateIdx++;
      if (state.gateIdx >= state.gates.length) {
        advanceTo(live, state, STAGE.LAND);
      } else {
        syncState(live, state);   // the next ring lights up
        if (player) out(player.id, `<span class="text-green">Ring ${state.gateIdx} of ${state.gates.length} — good.</span>`);
      }
    }
    return false;
  }

  if (ev === 'land' && state.stage === STAGE.LAND) {
    const grade = String(args[0] || '').toUpperCase();
    const fieldId = args[2];
    if (fieldId === LANDING_FIELD && PASS_GRADES.has(grade)) {
      await passCheckride(player);
      return true;   // index.js deletes the loaner after detach
    }
    // Survivable but not good enough (or wrong field): forgiving retry. The land flow
    // is about to park + detach the pilot onto the ramp; the loaner stays parked, so
    // they can `embark` it again (the boardFound gate lets the owner re-board their
    // loaner) and bring her around. State stays on LAND.
    if (player) out(player.id, `<span class="text-amber">Checkride: that won't pass${grade ? ` (Grade ${grade})` : ' — land at Coldwater Regional'}. Climb back into the trainer and bring her around again — Grade B or better.</span>`);
    return false;
  }

  return false;
}

async function passCheckride(player) {
  checkrides.delete(player.id);
  await setFlag('player', PILOT_LICENSE_FLAG, '1', player);
  out(player.id, '<span class="item-grant">★ CHECKRIDE PASSED — you\'re a licensed pilot now. Board any aircraft and fly.</span>');
}

// A crashed loaner ends the ride — no penalty, just start over with the examiner. The
// wreck row is aged out by the flight plugin's wreckSweep (it stamps crashed_at).
on('flight.crashed', ({ aircraftId, pilotId }) => {
  const state = pilotId && checkrides.get(pilotId);
  if (!state || state.loanerId !== aircraftId) return;
  checkrides.delete(pilotId);
  out(pilotId, '<span class="text-amber">Checkride over — you balled up the trainer. No harm done; see the examiner at Coldwater Regional to take it again.</span>');
});

export const _test = { STAGE, GATES, checkrides, isPilotLicensed, beginCheckride, evaluateCheckride, checkrideEvent, getCheckrideState, hasActiveCheckride };
