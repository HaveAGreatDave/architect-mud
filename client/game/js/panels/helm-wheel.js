// The Echelon's helm — a big, futuristic carbon-and-accent ship's wheel you grab and spin. It's a
// pure DIRECTION control: only the wheel's DIRECTION of spin steers her — turn it clockwise and the
// heading walks right (N→NE→E→SE→S…), counter-clockwise and it walks left. A fixed outer compass
// bezel + an upright ECHELON hub with a course needle read the heading; the carbon wheel turns inside.
//
// createHelmWheel(canvas, { accent, gear, onSteer(deg), getHeading() }) → controller.
//   onSteer(deg) — the CHANGE in demanded course this frame (signed: + = right/CW, − = left/CCW).
//   getHeading() — the boat's ACTUAL heading (deg) for the course needle. Optional.
//   gear         — wheel-turn per heading (higher = much more spinning per rhumb).

export function createHelmWheel(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
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
  function down(e) { if (!enabled) return; const c = centre(); grabbing = true; lastPA = angOf(e, c); vel = 0; lastT = performance.now(); canvas.setPointerCapture?.(e.pointerId); canvas.style.cursor = 'grabbing'; e.preventDefault(); }
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
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none';

  function step(dt) {
    if (!enabled) { vel = 0; reported = angle; return; }   // pinned while underway — accrue no course change
    if (!grabbing) { angle += vel * dt; vel *= Math.exp(-2.75 * dt); if (Math.abs(vel) < 0.03) vel = 0; }   // a big flywheel: a throw coasts ~twice as far and spins down slow (total follow-through ∝ vel/decay)
    const d = angle - reported;                 // how far the wheel turned since we last reported
    if (d) { onSteer((d / GEAR) * 180 / Math.PI); reported = angle; }   // spin direction → heading change (CW=right, CCW=left)
  }

  function draw() {
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
    setEnabled(on) { enabled = on !== false; if (!enabled) { grabbing = false; vel = 0; } canvas.style.cursor = enabled ? 'grab' : 'not-allowed'; },
    getAngle: () => angle,
    destroy() { alive = false; cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); removeEventListener('pointerup', up); },
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
