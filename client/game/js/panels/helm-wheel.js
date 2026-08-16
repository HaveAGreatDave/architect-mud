// The Echelon's helm — a big, futuristic carbon-and-accent ship's wheel you grab and spin. It's a
// pure DIRECTION control: only the wheel's DIRECTION of spin steers her — turn it clockwise and the
// heading walks right (N→NE→E→SE→S…), counter-clockwise and it walks left. A fixed outer compass
// bezel + an upright ECHELON hub with a course needle read the heading; the carbon wheel turns inside.
//
// createHelmWheel(canvas, { accent, gear, onSteer(deg), getHeading() }) → controller.
//   onSteer(deg) — the CHANGE in demanded course this frame (signed: + = right/CW, − = left/CCW).
//   getHeading() — the boat's ACTUAL heading (deg) for the course needle. Optional.
//   gear         — wheel-turn per heading (higher = much more spinning per rhumb).

// HEADLESS. Pass `canvas: null` and the widget keeps the whole of its job except the drawing —
// the angle, the lock, the self-centring, the keyboard, the drag API. The truck cab does this
// because its wheel is painted INTO the scene by the windshield renderer (drawCabWheel) rather
// than sitting in a box below it, and two wheels in one cab is one wheel too many. The state has
// to stay here regardless: it is where the self-centring and the lock clamp live, and a copy of
// those in the renderer is a copy that drifts.
// HOW FAR THE TRUCK'S WHEEL TURNS, in half-turns from centre to full lock — so 3.5 is three and a
// half turns lock to lock, which is a real tractor and a long way from the 1.6 this started at.
//
// ⚠ IT IS EXPORTED BECAUSE THE RENDERER NEEDS THE SAME NUMBER. The painted wheel in the scene
// (drawCabWheel in windshield.js) rotates the rim by this much at full lock, and it used to keep
// its own copy of it — so changing the travel here would have left the drawn wheel turning a
// different amount from the wheel you are holding, which is the one bug in a control nobody would
// think to look for.
// ⚠ MEASURED FROM CENTRE, SO THIS IS HALF-TURNS: 2 means ONE FULL REVOLUTION of the rim takes you
// from straight-ahead to the stops, and two full turns is lock to lock.
//
// It was 3.5 (a real tractor's travel) and that number is only honest with real hands on a real
// rim. With a mouse it meant a player physically could not reach the stops — you run out of screen,
// or out of patience, long before the axle runs out of travel — so the truck was permanently driven
// on a fraction of its steering and read as a barge. One turn to full lock is the compromise every
// driving game makes for the same reason: it is what a hand on a mouse can actually deliver.
//
// …AND ONE TURN WAS STILL TOO MANY, for a reason the 3.5 → 2.0 move did not go far enough to fix.
// A hand on a rim can wind indefinitely; a hand on a mouse gets ONE ARC before the pointer leaves
// the wheel and has to be re-grabbed, and that arc is about half a revolution at best. At 2.0 that
// is one grab, a re-grab, and a second arc to reach the stops — so full lock was never a thing you
// did in the middle of a manoeuvre, it was a thing you set up for. 0.75 puts the stops at 135° from
// centre: comfortably inside a single swoop, in either direction, without lifting the hand.
//
// It is deliberately NOT lower. Below about half a turn lock-to-lock the wheel stops being a wheel
// and becomes a slider you happen to drag in a circle — the spokes barely move, the thumb grips
// never change hands, and there is no longer any reason for the lock gauge or the full-lock legend
// to exist. This is the shallowest travel that still reads as winding something on.
export const TRUCK_LOCK_TURNS = 0.75;
export const TRUCK_LOCK_RAD = TRUCK_LOCK_TURNS * Math.PI;

export function createHelmWheel(canvas, opts = {}) {
  const ctx = canvas ? canvas.getContext('2d') : null;
  let accent = opts.accent || '#c8a24e';
  const onSteer = opts.onSteer || (() => {});
  const getHeading = opts.getHeading || null;
  const GEAR = opts.gear || 8;                 // 8 ⇒ ~one full wheel turn per 45° of heading (one rhumb)
  const SPOKES = 5;

  // The wheel reports only the CHANGE in its rotation each frame (see step) — it never asserts an
  // absolute course. So spinning it clockwise steers the heading right and counter-clockwise steers
  // left, the amount you spin being how far she comes round; and because it never re-demands a fixed
  // bearing, she can't be yanked back to a stale course after a passage (the old snap-home bug).
  // `angle` accumulates UNBOUNDED (it's a wheel — it wraps and keeps going), `reported` is the wheel
  // angle we last emitted a delta from, `lastPA` the pointer angle we last measured a delta against.
  let angle = 0, vel = 0, reported = 0;
  let grabbing = false, lastPA = 0, lastT = 0;
  let raf = 0, alive = true, last = performance.now();
  let enabled = true;   // locked (dimmed, no grab) while she's underway on a passage

  // Carbon-fibre 2×2 twill tile (reused as a rotating pattern).
  let carbon = null;
  function makeCarbon() {
    const size = 96, cell = 7, c = document.createElement('canvas');
    c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = '#0c0e11'; g.fillRect(0, 0, size, size);
    for (let gy = 0; gy * cell < size; gy++) for (let gx = 0; gx * cell < size; gx++) {
      const x = gx * cell, y = gy * cell, dir = (gx + gy) & 1;
      const gr = dir ? g.createLinearGradient(x, y, x + cell, y + cell) : g.createLinearGradient(x + cell, y, x, y + cell);
      gr.addColorStop(0, '#0a0c0f'); gr.addColorStop(0.5, '#2a313a'); gr.addColorStop(1, '#0a0c0f');
      g.fillStyle = gr; g.fillRect(x, y, cell, cell);
    }
    return c;
  }

  const centre = () => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const angOf = (e, c) => Math.atan2(e.clientY - c.y, e.clientX - c.x);
  function down(e) {
    if (!enabled) return;
    // The horn boss. A press inside the hub is the horn and is NOT a grab — pulling the wheel by
    // its centre gives you almost no leverage anyway (the angle delta at r≈0 is noise), so this
    // costs no steering and buys the control that is drawn there.
    if (TRUCK_ART && onHorn) {
      const b = canvas.getBoundingClientRect();
      const R = Math.min(b.width, b.height) / 2 - 2;
      if (Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2)) < R * 0.30) {
        onHorn(); e.preventDefault(); return;
      }
    }
    const c = centre(); grabbing = true; lastPA = angOf(e, c); vel = 0; lastT = performance.now(); canvas.setPointerCapture?.(e.pointerId); canvas.style.cursor = 'grabbing'; e.preventDefault(); }
  function move(e) {
    if (!grabbing) return;
    const c = centre(), pa = angOf(e, c);
    // Accumulate the pointer-angle DELTA (not an absolute), UNWRAPPING the atan2 branch cut at ±π —
    // so dragging across the wheel's left side never jumps the angle or flips the steer direction.
    // The hand turns the wheel 1:1 and it just keeps winding, clockwise = right, anticlockwise = left.
    let dp = pa - lastPA;
    if (dp > Math.PI) dp -= 2 * Math.PI; else if (dp < -Math.PI) dp += 2 * Math.PI;
    angle += dp; lastPA = pa;
    const now = performance.now(), dt = Math.max(0.001, (now - lastT) / 1000);
    vel = (dp / dt) * 0.5 + vel * 0.5; lastT = now;
  }
  function up() { if (grabbing) { grabbing = false; canvas.style.cursor = 'grab'; } }
  if (canvas) {
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none';
  }

  // ABSOLUTE mode — for a ROAD VEHICLE (THE LONG HAUL's cab). The default below is a boat's helm:
  // it reports the CHANGE in wheel rotation, so spinning it sets a course and letting go holds it.
  // That is exactly wrong for a truck. A road is a line you hold, not a bearing you set, and a
  // front axle self-centres the moment you stop pulling on it — so in this mode the wheel reports
  // its POSITION as a normalised −1..+1 axle deflection, is clamped to a real lock, and returns to
  // centre on release. Same widget, same art, same feel in the hand; the only difference is which
  // of the two questions it is answering. The yacht never passes `mode`, so it is untouched.
  const ABSOLUTE = opts.mode === 'absolute';
  // Which wheel is drawn. The yacht never passes this, so it keeps the helm it always had.
  const TRUCK_ART = opts.art === 'truck';
  const onHorn = opts.onHorn || null;              // the boss is a button, because on a truck it is
  const LOCK = (opts.lock || 1.6) * Math.PI;   // wheel rotation (rad) from centre to full lock
  const RETURN = opts.selfCentre ?? 5.0;       // how briskly the axle walks back to centre (per s)
  const KEY_RATE = opts.keyRate ?? 3.2;        // radians/s a held arrow key winds the wheel on
  // How fast a pair of HANDS can wind the rim, radians/s — see `wind` below. ~1.4 turns a second,
  // which is a hard, deliberate shuffle rather than a leisurely one; the keyboard is deliberately
  // slower still (KEY_RATE), because a held key is one finger and this is two hands.
  const HAND_RATE = opts.handRate ?? 9;
  // The two numbers the speed-scaled self-centring is shaped by (see stepAbsolute). `getSpeed`
  // returns the vehicle's own road speed — the widget asks rather than being told, so it can never
  // be holding a stale number from a frame that did not happen. A caller that passes nothing gets
  // the old constant return exactly, which is the migration invariant: the yacht is untouched.
  const getSpeed = opts.getSpeed || null;
  const RETURN_FULL_MPH = opts.centreFullAt ?? 40;   // by here the caster effect has all arrived
  const RETURN_FLOOR = 0.06;                         // what survives at a dead stop — see the ⚠
  let lastWind = 0;                            // when the hand last moved the wheel, for the rate limit
  let held = 0;                                // −1 / 0 / +1 from the keyboard
  // A SECOND PAIR OF HANDS ON THE SAME WHEEL. The cab lets you steer by dragging anywhere on the
  // windscreen — which is the control you actually want at speed, and the only one that works when
  // the wheel widget is a small thing in the corner of a fullscreen view. It must wind THIS angle,
  // not a parallel one, or the wheel on screen stops being the wheel you are turning; and while
  // that drag is live the self-centring has to stand down exactly as it does for a direct grab.
  let extGrab = false;

  function step(dt) {
    if (!enabled) { vel = 0; reported = angle; return; }   // pinned while underway — accrue no course change
    if (ABSOLUTE) return stepAbsolute(dt);
    if (!grabbing) { angle += vel * dt; vel *= Math.exp(-2.75 * dt); if (Math.abs(vel) < 0.03) vel = 0; }   // a big flywheel: a throw coasts ~twice as far and spins down slow (total follow-through ∝ vel/decay)
    const d = angle - reported;                 // how far the wheel turned since we last reported
    if (d) { onSteer((d / GEAR) * 180 / Math.PI); reported = angle; }   // spin direction → heading change (CW=right, CCW=left)
  }

  function stepAbsolute(dt) {
    // KEYBOARD STEERING. `held` is −1/0/+1 from an arrow key and it drives the SAME angle a hand
    // drags, which is the whole reason it lives in the widget rather than in the cab: a keyboard
    // driver has to turn the wheel you can see, not a parallel invisible one. Holding a key winds
    // the lock on at a rate a wrist would manage; letting go hands it straight back to the
    // self-centring below, so nothing has to remember that a key was ever down.
    if (held && !grabbing && !extGrab) angle = Math.max(-LOCK, Math.min(LOCK, angle + held * KEY_RATE * dt));
    if (!grabbing && !held && !extGrab) {
      // ── SELF-CENTRING, AND IT KNOWS HOW FAST YOU ARE GOING ──────────────────
      // A wheel does not return because of a spring. It returns because the front axle has caster
      // trail and the tyres make self-aligning torque, and BOTH of those scale with road speed —
      // which is why a real wheel is firm and eager at seventy and nearly dead when you are
      // shuffling round a yard, where you have to unwind the lock yourself with your own arms.
      //
      // The old constant return was the loudest remaining tell that this was a game: a parked truck
      // snapped its wheel back to centre exactly as briskly as one at motorway speed. Now the rate
      // is scaled by speed, and the shape matters more than the numbers — it climbs FAST off the
      // bottom and then saturates, because that is what caster does: most of the effect has arrived
      // by walking pace and the rest of the range only firms it up.
      //
      // ⚠ AT A STANDSTILL THE WHEEL STAYS WHERE YOU LEFT IT, and that is the point of the whole
      // change rather than a side effect. Park with lock wound on and it is still wound on when you
      // pull away — which is a real thing that happens to real drivers, is visible on the painted
      // wheel and on the lock gauge under the hub, and is the reason a yard manoeuvre now takes
      // hands rather than patience. The floor is not zero, though: a fraction of the rate survives
      // so a truck abandoned on full lock eventually finds centre rather than being stuck there
      // forever with nobody in the seat.
      // ⚠ NO `getSpeed` MEANS FULL RATE, NOT ZERO RATE. A caller that never opted into this must
      // behave exactly as it did before — and the failure mode of getting that backwards is a wheel
      // that never returns at all, in a vehicle whose author has no idea this option exists.
      const n = getSpeed ? Math.min(1, Math.abs(getSpeed() || 0) / RETURN_FULL_MPH) : 1;
      angle -= angle * Math.min(1, RETURN * (RETURN_FLOOR + (1 - RETURN_FLOOR) * Math.pow(n, 0.55)) * dt);
      if (Math.abs(angle) < 0.004) angle = 0;
      vel = 0;
    }
    if (angle > LOCK) angle = LOCK; else if (angle < -LOCK) angle = -LOCK;
    onSteer(Math.max(-1, Math.min(1, angle / LOCK)));
    reported = angle;
  }

  // ── THE TRUCK WHEEL ───────────────────────────────────────────────────────
  // `art: 'truck'` replaces the yacht's helm entirely, and it had to: what was on the cab's dash
  // was a five-spoke ship's wheel with a COMPASS BEZEL around it and ECHELON stamped on the boss —
  // a yacht's instrument, in a diesel truck, telling a driver their heading in cardinal points
  // while they tried to hold a lane. The bezel was actively misleading, because in absolute mode
  // the thing you steer with is the wheel's POSITION and the bezel is a fixed ring that never moves
  // with it; a driver reading N/E/S/W was reading a control they were not operating.
  //
  // So: no bezel, no cardinal points, no wordmark, no course needle. A three-spoke commercial-
  // vehicle wheel, a horn boss, and the ONE indicator a truck actually has — a lock gauge under the
  // hub showing how much steering is wound on and which way. It fills the whole canvas, because the
  // ring you have to be able to grab with a thumb is the primary control in this cab.
  function drawTruck() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.globalAlpha = enabled ? 1 : 0.4;
    const cx = box.width / 2, cy = box.height / 2, R = Math.min(box.width, box.height) / 2 - 2;
    const rimO = R * 0.97, rimI = R * 0.78, hubR = R * 0.30;
    const lock = Math.max(-1, Math.min(1, angle / LOCK));

    // The lock gauge: a fixed arc across the bottom with a travelling pip. It does NOT rotate, and
    // that is the point — it is the one part of the display that answers "how much have I got on?"
    // when the wheel itself has been spun far enough that you have lost count of the spokes.
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineWidth = Math.max(2, R * 0.035); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(120,140,160,0.25)';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.995, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
    const gA = Math.PI * 0.5 + lock * Math.PI * 0.32;
    ctx.strokeStyle = Math.abs(lock) > 0.92 ? '#d2603f' : accent;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.995, Math.PI * 0.5, gA, lock < 0); ctx.stroke();
    ctx.shadowBlur = 0;
    // Centre notch — the straight-ahead mark you steer back to.
    ctx.strokeStyle = 'rgba(210,225,240,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, R * 0.94); ctx.lineTo(0, R * 1.05); ctx.stroke();
    ctx.restore();

    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    // The rim: moulded polyurethane over a steel core, not carbon. Two tones and a highlight is
    // enough to read as something you grip rather than something you polish.
    const rg = ctx.createRadialGradient(0, -rimO * 0.4, rimI * 0.2, 0, 0, rimO);
    rg.addColorStop(0, '#3a3f47'); rg.addColorStop(0.55, '#23272d'); rg.addColorStop(1, '#14171b');
    ctx.beginPath(); ctx.arc(0, 0, rimO, 0, 7); ctx.arc(0, 0, rimI, 0, 7, true);
    ctx.fillStyle = rg; ctx.fill('evenodd');
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.arc(0, 0, rimO - 1, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(0, 0, rimI + 1, 0, 7); ctx.stroke();
    // Thumb grips at ten and two — the two places a hand actually lives, and the fastest read of
    // which way up the wheel is when it is wound over.
    for (const a of [-Math.PI * 0.72, -Math.PI * 0.28]) {
      ctx.save(); ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, -R * 0.055, -rimO + R * 0.02, R * 0.11, (rimO - rimI) - R * 0.04, R * 0.03);
      ctx.fill(); ctx.restore();
    }
    // Three spokes: one up, two down at 120°. A truck wheel, in one line of geometry.
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i / 3 * Math.PI * 2);
      const sg = ctx.createLinearGradient(-R * 0.06, 0, R * 0.06, 0);
      sg.addColorStop(0, '#1a1e23'); sg.addColorStop(0.5, '#333941'); sg.addColorStop(1, '#1a1e23');
      ctx.fillStyle = sg;
      roundRect(ctx, -R * 0.075, -rimI - 1, R * 0.15, rimI - hubR * 0.55, R * 0.05); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // The boss stays UPRIGHT — it is bolted to the column, not to the rim, and a horn push that
    // spun round with the wheel would be the one part nobody could aim for.
    ctx.save(); ctx.translate(cx, cy);
    const bg = ctx.createRadialGradient(-hubR * 0.3, -hubR * 0.35, 1, 0, 0, hubR);
    bg.addColorStop(0, '#2c323a'); bg.addColorStop(1, '#0d1013');
    ctx.beginPath(); ctx.arc(0, 0, hubR, 0, 7); ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = Math.max(1.5, R * 0.018); ctx.strokeStyle = shade(accent, 0.8);
    ctx.beginPath(); ctx.arc(0, 0, hubR * 0.92, 0, 7); ctx.stroke();
    ctx.fillStyle = shade(accent, 0.9);
    ctx.font = `700 ${Math.max(7, hubR * 0.26)}px 'DejaVu Sans Mono',monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HORN', 0, 0);
    ctx.restore();

    // ── ON THE STOPS ──────────────────────────────────────────────────────────
    // A truck's steering runs out, and until now the only thing that said so was the pip on the
    // lock gauge going red at the end of its arc — a two-pixel colour change at the bottom of the
    // wheel, while your eye is on the road and your hand is still winding. So full lock gets a
    // legend of its own, and three decisions make it readable:
    //
    //  · IT DOES NOT ROTATE. At full lock the rim has been through a whole revolution, so anything
    //    painted ON it is wherever the winding left it. This is bolted to the column beside the
    //    boss, at twelve o'clock, which is the one place on a wheel your eye is already using.
    //  · IT SAYS WHICH WAY. Two chevrons pointing the way the wheel is wound — at the stops the rim
    //    itself is symmetric and the spokes have long since stopped telling you anything.
    //  · AND IT IS THE GAUGE'S OWN RED, not a new colour. The pip and this are the same fact said
    //    twice at two distances, and two different reds would read as two different faults.
    if (Math.abs(lock) > 0.995) {
      const s = Math.sign(lock), red = '#d2603f', y = -(rimI + hubR) / 2;
      ctx.save(); ctx.translate(cx, cy);
      ctx.globalAlpha *= 0.9 + 0.1 * Math.sin(performance.now() / 260);   // a slow breath: present, never a strobe
      ctx.strokeStyle = red; ctx.lineWidth = Math.max(1.6, R * 0.022); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = red; ctx.shadowBlur = 6;
      for (let i = 0; i < 2; i++) {
        const x = s * (R * 0.10 + i * R * 0.075), w = R * 0.05, hh = R * 0.055;
        ctx.beginPath(); ctx.moveTo(x - s * w, y - hh); ctx.lineTo(x, y); ctx.lineTo(x - s * w, y + hh); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = red; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(7, R * 0.085)}px 'DejaVu Sans Mono',monospace`;
      ctx.fillText('LOCK', 0, y);
      ctx.restore();
    }
  }

  function draw() {
    if (!canvas) return;                       // headless — the scene draws this wheel (see the header)
    if (TRUCK_ART) return drawTruck();
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.globalAlpha = enabled ? 1 : 0.4;   // dim the whole wheel while pinned underway
    const cx = box.width / 2, cy = box.height / 2, R = Math.min(box.width, box.height) / 2 - 3;
    if (!carbon) carbon = makeCarbon();
    const pat = ctx.createPattern(carbon, 'repeat');

    // ── Fixed compass bezel (does NOT rotate) — graduations + NESW + a top lubber index ──
    const bezO = R, bezI = R * 0.86;
    ctx.save(); ctx.translate(cx, cy);
    const bz = ctx.createRadialGradient(0, 0, bezI, 0, 0, bezO);
    bz.addColorStop(0, '#0c1015'); bz.addColorStop(1, '#05080b');
    ctx.beginPath(); ctx.arc(0, 0, bezO, 0, 7); ctx.arc(0, 0, bezI, 0, 7, true); ctx.fillStyle = bz; ctx.fill('evenodd');
    for (let d = 0; d < 360; d += 15) {
      const a = (d - 90) * Math.PI / 180, card = d % 90 === 0, diag = !card && d % 45 === 0;   // the four diagonals are steering notches too
      const r0 = card ? bezI - R * 0.02 : (diag ? bezI + R * 0.005 : bezI + R * 0.03), r1 = bezO - R * 0.02;
      ctx.strokeStyle = card ? accent : (diag ? shade(accent, 0.7) : 'rgba(150,170,185,0.4)'); ctx.lineWidth = card ? 2 : (diag ? 1.6 : 1);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
    }
    ctx.fillStyle = accent; ctx.font = `700 ${R * 0.1}px 'DejaVu Sans Mono',monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [lab, d] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) { const a = (d - 90) * Math.PI / 180, rr = (bezO + bezI) / 2; ctx.fillText(lab, Math.cos(a) * rr, Math.sin(a) * rr); }
    // Lubber index (fixed, top) — the accent triangle you steer against.
    ctx.fillStyle = shade(accent, 1.2); ctx.beginPath(); ctx.moveTo(0, -bezO - 1); ctx.lineTo(-R * 0.05, -bezI + R * 0.02); ctx.lineTo(R * 0.05, -bezI + R * 0.02); ctx.closePath(); ctx.fill();
    ctx.restore();

    // ── Rotating wheel (rim + spokes + handles) ──
    const rimO = bezI - R * 0.02, rimI = rimO * 0.72, hubR = R * 0.24;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);

    for (let i = 0; i < SPOKES; i++) {                 // handle pegs beyond the rim
      ctx.save(); ctx.rotate(i / SPOKES * Math.PI * 2); const king = i === 0;
      ctx.fillStyle = pat; roundRect(ctx, -R * 0.045, -rimO - R * 0.24, R * 0.09, R * 0.28, R * 0.045); ctx.fill();
      ctx.lineWidth = king ? 2.6 : 1.4; ctx.strokeStyle = shade(accent, king ? 1.15 : 0.5); ctx.stroke();
      ctx.fillStyle = king ? shade(accent, 1.25) : shade(accent, 0.75);
      ctx.beginPath(); ctx.arc(0, -rimO - R * 0.24, R * 0.05, 0, 7); ctx.fill();
      if (king) { ctx.shadowColor = accent; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(0, -rimO - R * 0.24, R * 0.05, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
      ctx.restore();
    }
    // Rim — carbon ring, twin accent LED grooves + bevel.
    ctx.beginPath(); ctx.arc(0, 0, rimO, 0, 7); ctx.arc(0, 0, rimI, 0, 7, true); ctx.fillStyle = pat; ctx.fill('evenodd');
    ctx.lineWidth = Math.max(2, R * 0.02); ctx.strokeStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0, 0, rimO - R * 0.03, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, rimI + R * 0.03, 0, 7); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(0, 0, rimO - 1, 0, 7); ctx.stroke();
    // Spokes.
    for (let i = 0; i < SPOKES; i++) {
      ctx.save(); ctx.rotate(i / SPOKES * Math.PI * 2);
      ctx.fillStyle = pat; roundRect(ctx, -R * 0.05, -rimI, R * 0.10, rimI - hubR * 0.3, R * 0.03); ctx.fill();
      ctx.lineWidth = i === 0 ? 2.2 : 1.2; ctx.strokeStyle = shade(accent, i === 0 ? 1 : 0.4); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ── Fixed hub cap (upright) — carbon dome, accent ring, ECHELON, course needle, boss ──
    ctx.save(); ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, hubR, 0, 7); ctx.fillStyle = pat; ctx.fill();
    const dome = ctx.createRadialGradient(-hubR * 0.3, -hubR * 0.35, 1, 0, 0, hubR);
    dome.addColorStop(0, 'rgba(70,80,92,0.5)'); dome.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = dome; ctx.beginPath(); ctx.arc(0, 0, hubR, 0, 7); ctx.fill();
    ctx.lineWidth = Math.max(2, R * 0.022); ctx.strokeStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(0, 0, hubR * 0.9, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    // Course needle — points at the boat's ACTUAL heading (eases slowly), so you see her come round.
    if (getHeading) {
      const hd = ((getHeading() % 360) + 360) % 360, a = (hd - 90) * Math.PI / 180;
      ctx.save(); ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = shade(accent, 1.3); ctx.shadowColor = accent; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(0, -hubR * 0.78); ctx.lineTo(-hubR * 0.16, hubR * 0.1); ctx.lineTo(hubR * 0.16, hubR * 0.1); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
    }
    // ECHELON wordmark (upright, under the boss).
    ctx.fillStyle = accent; ctx.font = `700 ${hubR * 0.28}px 'DejaVu Sans Mono',monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.scale(1, 1); ctx.fillText('ECHELON', 0, hubR * 0.5); ctx.restore();
    const boss = ctx.createRadialGradient(-hubR * 0.2, -hubR * 0.2, 1, 0, 0, hubR * 0.34);
    boss.addColorStop(0, shade(accent, 1.3)); boss.addColorStop(1, shade(accent, 0.5));
    ctx.fillStyle = boss; ctx.beginPath(); ctx.arc(0, 0, hubR * 0.22, 0, 7); ctx.fill();
    ctx.restore();
  }

  function frame(now) { if (!alive) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    setAccent(a) { accent = a || accent; },
    // Keyboard input, routed through the widget so the wheel a keyboard driver turns is the one on
    // the screen. Absolute mode only — a boat sets a course and has no use for a held key.
    setHeld(dir) { held = ABSOLUTE ? Math.max(-1, Math.min(1, dir | 0)) : 0; },
    // Steering from somewhere that is not the wheel — the cab's glass drag. `setDragging` suspends
    // the self-centring for as long as the hand is down, `wind` adds rotation in radians. Both are
    // absolute-mode only: a boat sets a course, and winding a course on from a drag on the horizon
    // is not a thing anybody would mean by it.
    setDragging(on) { if (ABSOLUTE) { extGrab = !!on; if (extGrab) { held = 0; lastWind = 0; } } },
    // ── A HAND CAN ONLY TURN A WHEEL SO FAST ─────────────────────────────────
    // A mouse can cross the screen in one frame, so a flick could put the wheel on the stops in
    // 16 milliseconds — which is not steering, it is teleporting the axle, and it is the reason a
    // truck could be thrown into a corner in a way no driver could ever have thrown it.
    //
    // So the wheel is RATE LIMITED to what a pair of hands manages: about a turn and a half a
    // second, which takes it from centre to full lock in roughly half a second of deliberate
    // winding. Under that limit nothing changes at all — ordinary steering inputs are nowhere near
    // it — and above it the wheel simply cannot keep up with you.
    //
    // ⚠ THE HAND SLIPS ON THE RIM, and that is the correct outcome rather than a compromise. Once
    // the limit bites, the wheel is no longer exactly under the point you grabbed — which is what
    // happens when you yank a heavy wheel faster than it will go. Trying to keep the grip point
    // pinned would mean either ignoring the limit or dragging the pointer around, and the second of
    // those is a thing no game should do to a cursor.
    //
    // Measured against real elapsed time, not per call: pointermove fires far more often on a
    // 240Hz mouse than on a 60Hz one, and a per-event cap would make the wheel's top speed a
    // property of the player's hardware.
    wind(dRad) {
      if (!ABSOLUTE) return;
      const now = performance.now();
      // A FRESH GRAB IS NOT A ZERO-LENGTH ONE. Without this the first move after taking hold gets a
      // dt of nearly nothing, so the cap is nearly nothing and the wheel refuses the first shove —
      // which reads as the control being stuck rather than as it being heavy. A gap means a new
      // grab, and a new grab is allowed one ordinary frame's worth of movement.
      const gap = now - lastWind;
      const dt = (!lastWind || gap > 200) ? 1 / 60 : Math.min(0.1, Math.max(0.001, gap / 1000));
      lastWind = now;
      const cap = HAND_RATE * dt;
      const d = Math.max(-cap, Math.min(cap, dRad || 0));
      angle = Math.max(-LOCK, Math.min(LOCK, angle + d));
    },
    setEnabled(on) { enabled = on !== false; if (!enabled) { grabbing = false; vel = 0; } if (canvas) canvas.style.cursor = enabled ? 'grab' : 'not-allowed'; },
    getAngle: () => angle,
    // The normalised −1..+1 lock — what the truck is actually steered by, and what the scene draws
    // the rim's rotation from. One number, one owner.
    getLock: () => Math.max(-1, Math.min(1, angle / LOCK)),
    destroy() { alive = false; cancelAnimationFrame(raf); canvas?.removeEventListener('pointerdown', down); canvas?.removeEventListener('pointermove', move); removeEventListener('pointerup', up); },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round((n >> 16) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}
