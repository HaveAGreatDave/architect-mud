// BANK HOLD: the arrow keys roll her into a bank, and she keeps it when you let go.
//
// ← and → move a bank TARGET; a small controller flies the aileron to it. A press steps the
// target `step` degrees, holding the key past `delay` rolls it on at `rate` degrees a second, and
// letting go leaves it where it is. Rolling back through level stops at level (the detent), so
// "hold ← until the wings are flat" can't overshoot into a left bank. A target of 0 with the wings
// level hands the stick back and the hold ends.
//
// Pure: no DOM, no clock, no imports. cockpit.js owns the keys and the hand-off rules (a yoke
// drag or a sideways mouse takes her back); this owns the target and what it does to the stick.
// It reads the flight model's own state and type row, so it is stepped headless by
// scripts/bank-hold-tune.mjs against every airframe.
//
// ⚠ THE AILERON IN THIS MODEL IS A ROLL RATE, NOT A BANK ANGLE. Let go and `rollStable` levels
// the wings (flight-model.js §4), so a held bank needs a standing deflection. The feed-forward
// below is that deflection solved from the same equation the model integrates, and the
// proportional and damping terms only have to fly the transition. The small integral is there for
// what the equation doesn't know about: a sheared wing, turbulence, the Drake's own quirks.
//
// ⚠ A BANK COSTS LIFT. The model's vertical lift goes with cos(bank) (§6a), so a held 45° turn
// with nothing on the elevator spirals down. Fixed-wing only, the hold adds BACK-PRESSURE to keep
// the vertical speed it had when the hold took her (`pull`). It is never a push, it is returned
// as its own number so the cockpit adds it to the pilot's elevator rather than replacing it, and
// it backs off ahead of the stall and the g limit. A rotor's lift doesn't fall with bank in this
// model, so a helicopter gets no pull.

export const BANK_HOLD = {
  step: 5,          // degrees one press moves the target
  rate: 30,         // degrees a second the target rolls while a key is held past `delay`
  delay: 0.3,       // seconds held before the target starts rolling
  max: 60,          // fixed-wing ceiling: a level 60° turn is 2g. bankLimit lowers it per type
  maxHeli: 40,      // rotor ceiling; bankLimit lowers it to what the cyclic can hold
  // The roll loop. Aileron per degree of error; damping per degree a second of roll rate, fixed
  // (`kd`) and as a share of the type's own aileron lag (`lead`, see stepBankHold); the integral's
  // gain (aileron per degree-second), ceiling, and the error inside which it runs.
  kp: 1 / 18, kd: 0, lead: 0.6, ki: 0.03, iMax: 0.35, iBand: 4,
  // The pull. Elevator per 1000 fpm of sink below the reference; the learned gain's starting
  // value, learning rate and ceiling (elevator per unit of 1/cos φ − 1); and the most it may add.
  vsKp: 0.15, kq: 0.08, gain0: 0.2, vsKi: 0.4, gainMax: 0.9, pullMax: 0.45,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const D2R = Math.PI / 180;

export function createBankHold() {
  return {
    on: false,       // the hold has the aileron
    target: 0,       // degrees, + is right wing down (the model's sign)
    key: 0,          // -1 ← held, +1 → held, 0 neither
    held: 0,         // seconds the current key has been down
    detent: false,   // stopped at level on the way through; a fresh press goes on
    i: 0,            // roll integral (aileron)
    rate: 0,         // measured roll rate, deg/s, smoothed
    lastBank: null,
    q: 0,            // measured pitch rate, deg/s, smoothed
    lastPitch: null,
    vsRef: 0,        // the vertical speed the pull keeps, fpm
    pi: 0,           // pull integral (elevator)
    pull: 0,         // the back-pressure this frame, for the cockpit to add
    aileron: 0,      // the stick this frame
    why: null,       // why the last hold ended, set by releaseBankHold
  };
}

// The steepest bank the hold will take for this type.
// ⚠ A ROTOR'S CEILING IS rollRate / rollStable: full cyclic against the self-levelling, which is
// 20° for the Drake and 27° for the Dragonfly. A target past it is a hold that never arrives.
// ⚠ A WING'S IS ITS STRUCTURE: a level turn pulls 1/cos φ, and the hold overshoots a little on
// the way in, so the Leviathan (gLimit 2.5) stops at 55° rather than creaking at 60.
export function bankLimit(p) {
  if (!p) return BANK_HOLD.max;
  if (p.heli) return Math.min(BANK_HOLD.maxHeli, Math.floor(0.92 * (p.rollRate || 0) / Math.max(0.1, p.rollStable || 1)));
  const n = 0.72 * (p.gLimit || 4.4), byG = n > 1 ? Math.acos(1 / n) / D2R : 0;
  return Math.min(BANK_HOLD.max, Math.floor(byG / BANK_HOLD.step) * BANK_HOLD.step);
}

// Snap to the step, so a released key leaves a round number on the HUD.
const snap = (v) => Math.round(v / BANK_HOLD.step) * BANK_HOLD.step;

// Move the target by `d`, stopping at level when it would cross it. Returns true at the detent.
function moveTarget(h, d, lim) {
  const was = h.target, next = clamp(was + d, -lim, lim);
  if ((was > 0 && next <= 0) || (was < 0 && next >= 0)) { h.target = 0; return true; }
  h.target = next;
  return false;
}

// A key edge. `dir` is -1 for ←, +1 for →. `s` is the flight model's state, `p` its type row.
// Returns what changed, for the cockpit's toast: 'engage', 'step', 'level' or null.
export function bankKey(h, dir, down, s, p) {
  const lim = bankLimit(p);
  if (!down) {
    if (dir === h.key) { h.key = 0; h.held = 0; h.target = clamp(snap(h.target), -lim, lim); }
    return null;
  }
  if (dir === h.key) return null;   // the keyboard's own repeat
  let ev = 'step';
  if (!h.on) {
    // Take her from where she is, so a press never snaps the wings toward a number.
    h.on = true; ev = 'engage';
    h.target = clamp(snap(s.bank || 0), -lim, lim);
    h.i = 0; h.rate = 0; h.lastBank = s.bank || 0; h.q = 0; h.lastPitch = s.pitch || 0;
    h.vsRef = s.vs || 0; h.pi = BANK_HOLD.gain0; h.pull = 0;
  }
  h.key = dir; h.held = 0; h.detent = false;
  if (moveTarget(h, dir * BANK_HOLD.step, lim)) { h.detent = true; ev = 'level'; }
  return ev;
}

// Let go of everything. `why` is what the cockpit tells the pilot: 'level', 'stall', or its own
// reasons (a hand on the yoke, the ground).
export function releaseBankHold(h, why = null) {
  h.on = false; h.key = 0; h.held = 0; h.detent = false; h.why = why;
  h.target = 0; h.i = 0; h.pi = 0; h.pull = 0; h.aileron = 0; h.lastBank = null; h.lastPitch = null;
}

// One frame. Writes `h.aileron` and `h.pull` and returns true while the hold has the stick.
// `opts.pitchHand`: the pilot is flying the elevator, so the pull re-takes its reference from
// whatever they leave her doing rather than fighting them for it.
export function stepBankHold(h, s, p, dt, opts = {}) {
  if (!h.on || !(dt > 0)) return false;
  const lim = bankLimit(p), B = BANK_HOLD;

  // A held key rolls the target on, after the first step's pause and not past the detent.
  if (h.key) {
    h.held += dt;
    if (h.held > B.delay && !h.detent && moveTarget(h, h.key * B.rate * dt, lim)) h.detent = true;
  }

  const bank = s.bank || 0, pitch = s.pitch || 0;
  const raw = h.lastBank == null ? 0 : (bank - h.lastBank) / dt;
  const rawQ = h.lastPitch == null ? 0 : (pitch - h.lastPitch) / dt;
  h.lastBank = bank; h.lastPitch = pitch;
  h.rate += (raw - h.rate) * Math.min(1, dt * 20);
  h.q += (rawQ - h.q) * Math.min(1, dt * 20);

  // A stall is the pilot's to fly out of: aileron into a dropping wing drives it deeper (§6c).
  if (s.stalled) { releaseBankHold(h, 'stall'); return false; }
  // Level and settled with no key down: the hold is done and the stick goes back.
  if (h.target === 0 && !h.key && Math.abs(bank) < 1.5 && Math.abs(h.rate) < 4) { releaseBankHold(h, 'level'); return false; }

  // Feed-forward: the standing deflection that holds this bank, from the model's own §4.
  const tgt = h.target, a = Math.abs(tgt);
  let ff;
  if (p.heli) ff = Math.sign(tgt) * clamp((p.rollStable || 0) * a / Math.max(1, p.rollRate || 1), 0, 1);
  else {
    const auth = clamp((s.airspeed || 0) / Math.max(1, p.vr || 1), 0, 1.2);
    const resist = 1 - 0.4 * a / 70;
    const c = (p.rollRate || 0) * auth * resist * (1 - 0.75 * (s.stallDepth || 0));
    const k = (p.rollStable || 0) * a;
    ff = Math.sign(tgt) * (c + k > 0 ? clamp(k / (c + k), 0, 1) : 0);
  }
  // ⚠ THE DAMPING IS THE TYPE'S OWN LAG. The aileron reaches the wing through `rollTau` (0.3 s
  // on the Dragonfly, 1.45 s on the Leviathan), so the bank keeps coming for about that long after
  // the stick eases. Leading the error by the rate times that lag is what stops the overshoot; a
  // fixed gain suits one airframe and overshoots the heavy.
  // ⚠ The integral only runs near the target. On the roll-in the error is tens of degrees for a
  // second or more, which winds it to its ceiling and is then an overshoot of that size.
  const err = tgt - bank;
  if (Math.abs(err) < B.iBand) h.i = clamp(h.i + err * B.ki * dt, -B.iMax, B.iMax);
  const kd = B.kd + B.kp * (p.rollTau || 0.6) * B.lead;
  h.aileron = clamp(ff + err * B.kp + h.i - h.rate * kd, -1, 1);

  // The pull: fixed wing only, and only back-pressure.
  // ⚠ LEARNED AS A GAIN ON THE TURN'S EXCESS LOAD, NEVER AS A STICK POSITION. A level turn needs
  // 1/cos φ of lift, so the pull is `pi × (1/cos φ − 1)`: nothing wings-level, the most at the
  // limit. Learned as a plain deflection, the pull a 60° turn needed was still on the stick as the
  // wings came level, and the Leviathan ballooned 435 fpm on every roll-out.
  if (p.heli || s.onGround) { h.pull = 0; h.pi = B.gain0; }
  else if (opts.noPull) h.pull = 0;
  else {
    const ex = 1 / Math.cos(Math.min(80, Math.abs(bank)) * D2R) - 1;
    const e = ((h.vsRef || 0) - (s.vs || 0)) / 1000;
    // A hand on the elevator flies the pitch: the gain stops learning and the reference follows
    // them, so letting go keeps what they left her doing. The learned share of the turn stays on.
    if (opts.pitchHand) h.vsRef = s.vs || 0;
    else if (ex > 0.03) h.pi = clamp(h.pi + e * B.vsKi * dt, 0, B.gainMax);
    // Ahead of the stall and the structure: a hold must never be what breaks the wing.
    const margin = clamp(((s.stallMargin ?? 1) - 0.25) / 0.35, 0, 1);
    const gLim = p.gLimit || 4.4, gRoom = clamp((gLim * 0.85 - (s.g || 1)) / (gLim * 0.15), 0, 1);
    const guard = Math.min(margin, gRoom);
    if (guard < 1) h.pi *= 1 - (1 - guard) * Math.min(1, dt * 3);
    // ⚠ AND DAMPED ON THE NOSE. The pull reaches the vertical speed through two lags (the
    // elevator's pitchTau, then the path's vsTau), so a loop on the vertical speed alone nods the
    // nose 3-4° on an 8-second cycle at 60° in the Shrike while holding the height to ±10 ft.
    // Leaning against the pitch rate is what settles it.
    const prop = opts.pitchHand ? 0 : (e * B.vsKp - h.q * B.kq) * Math.min(1, ex * 6);
    h.pull = clamp(h.pi * ex + prop, 0, B.pullMax) * guard;
  }
  return true;
}
