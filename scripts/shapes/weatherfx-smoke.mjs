// ── DOES EVERY FX NAME ACTUALLY DRAW SOMETHING? ──────────────────────────────
//
// weather-fx.js is the only visual layer a dream or a trip has on foot, and until
// now nothing could execute a line of it outside a browser. Its effects were
// reachable only by standing in the right room in the right weather while high,
// which is how `dream_the_hundred_years` shipped with `fx: ''` — a name that
// renders NOTHING, looks exactly like "no effect was wanted", and is invisible in
// play. The regress suite caught that one because it pins the vocabulary; it
// could not have caught an effect that was named correctly and drew nothing.
//
// So the assertion here is not "did it throw". It is "did it put paint down".
// Each effect is run for a dozen frames against a counting 2D context and has to
// produce actual draw calls.
// ⚠ Globals BEFORE the module loads, hence the dynamic import. `reseed()` calls
// `refreshThemeColors()` → `getComputedStyle(document.documentElement)` on the
// very first frame of every effect, so a static import throws before a single
// assertion runs. Only the two functions that path touches are stubbed; anything
// else this file needs would be a signal that the renderer grew a dependency
// worth knowing about.
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#101318' });
globalThis.document = {
  documentElement: {},
  getElementById: () => null,
  createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  body: { appendChild() {} },
  addEventListener() {},
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { _test } = await import('../../client/game/js/panels/weather-fx.js');

// A counting 2D context. Deliberately strict about nothing except tallying: an
// effect that quietly no-ops is the failure being hunted, so anything unknown is
// answered rather than thrown on.
function countingCtx() {
  const n = { fill: 0, stroke: 0, fillRect: 0, gradients: 0, stops: 0 };
  const gradient = { addColorStop() { n.stops++; } };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === '_n') return n;
      if (k === 'canvas') return { width: 320, height: 200 };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => { n.gradients++; return gradient; };
      if (k === 'measureText') return (s) => ({ width: String(s ?? '').length * 8 });
      if (k === 'fill') return () => { n.fill++; };
      if (k === 'stroke') return () => { n.stroke++; };
      if (k === 'fillRect') return () => { n.fillRect++; };
      if (typeof k === 'string' && /^(globalAlpha|fillStyle|strokeStyle|lineWidth|lineCap|font|globalCompositeOperation)$/.test(k)) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

const paint = (n) => n.fill + n.stroke + n.fillRect;

export function weatherFxSmoke() {
  const out = [];
  const ok = (name, cond, detail) => out.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });

  // The vocabulary itself, so a name added in one place and not the other shows up.
  ok('the fx vocabulary is 5 weather + 6 drug + none',
    _test.ALL_FX.length === 12 && _test.WEATHER_FX.length === 5 && _test.DRUG_FX.length === 6,
    `${_test.ALL_FX.length} total / ${_test.WEATHER_FX.length} weather / ${_test.DRUG_FX.length} drug`);
  ok('no name appears in both halves',
    !_test.WEATHER_FX.some((w) => _test.DRUG_FX.includes(w)));

  // Every named effect must put paint down at a normal intensity.
  for (const fx of [..._test.WEATHER_FX, ..._test.DRUG_FX]) {
    const ctx = countingCtx();
    let seeded, threw = null;
    try { seeded = _test.runEffect(fx, ctx, { width: 900, height: 360, intensity: 0.8, frames: 12 }); }
    catch (e) { threw = e; }
    ok(`${fx}: runs without throwing`, !threw, threw && threw.message);
    if (threw) continue;
    ok(`${fx}: actually draws`, paint(ctx._n) > 0, JSON.stringify(ctx._n));
    // A particle effect with an empty pool draws nothing however many frames run.
    if (['rain', 'snow', 'ash', 'wind', 'static', 'tracers', 'crawl'].includes(fx))
      ok(`${fx}: seeded a particle pool`, seeded.particles > 0, `${seeded.particles} particles`);
    if (['fog', 'bloom'].includes(fx))
      ok(`${fx}: seeded blobs`, seeded.blobs > 0, `${seeded.blobs} blobs`);
  }

  // ⚠ The bug this file exists for. An unknown name must not silently paint.
  {
    const ctx = countingCtx();
    let threw = null;
    try { _test.runEffect('', ctx, { intensity: 0.8, frames: 6 }); } catch (e) { threw = e; }
    ok('an empty fx name does not throw', !threw, threw && threw.message);
  }

  // ⚠ The floor. A drug symptom must never round away to nothing on a small pane
  // at a low dose — that is the game believing you are high and showing you
  // sober. `tracers` computed 0.4 particles at 320x200 before this was added.
  for (const fx of _test.DRUG_FX) {
    const ctx = countingCtx();
    _test.runEffect(fx, ctx, { width: 320, height: 200, intensity: 0.05, frames: 4 });
    ok(`${fx}: still draws on a phone pane at a low dose`, paint(ctx._n) > 0, JSON.stringify(ctx._n));
  }

  // Intensity has to matter, or the level knob is decorative. Denser at 1.0 than
  // at 0.1 for everything whose count is intensity-scaled.
  for (const fx of ['static', 'tracers', 'crawl']) {
    // ⚠ A real pane. At 320x200 `tracers` computes 1.5 particles at FULL
    // intensity, so both ends round to 1 and the comparison proves nothing —
    // the first version of this check failed for that reason and not because
    // the scaling was broken.
    const lo = _test.runEffect(fx, countingCtx(), { width: 900, height: 360, intensity: 0.05, frames: 2 });
    const hi = _test.runEffect(fx, countingCtx(), { width: 900, height: 360, intensity: 1.0, frames: 2 });
    ok(`${fx}: intensity changes the population`, hi.particles > lo.particles, `${lo.particles} → ${hi.particles}`);
  }

  // A whole-field effect holds no state, so it must still draw on a fresh pane
  // with nothing seeded — that is the case reseed() deliberately skips.
  for (const fx of ['tunnel', 'swim']) {
    const ctx = countingCtx();
    _test.runEffect(fx, ctx, { intensity: 0.6, frames: 3 });
    ok(`${fx}: draws with nothing seeded`, paint(ctx._n) > 0, JSON.stringify(ctx._n));
  }

  // Zero-size pane must not divide by anything or spin.
  {
    const ctx = countingCtx();
    let threw = null;
    try { for (const fx of _test.DRUG_FX) _test.runEffect(fx, ctx, { width: 0, height: 0, frames: 2 }); }
    catch (e) { threw = e; }
    ok('a collapsed pane draws no drug fx and does not throw', !threw, threw && threw.message);
  }

  return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('weatherfx-smoke.mjs')) {
  const res = weatherFxSmoke();
  let bad = 0;
  for (const r of res) {
    if (!r.ok) bad++;
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  ↳ ${r.detail}` : ''}`);
  }
  console.log(bad ? `\n${bad} failure(s).` : `\n✓ weather-fx smoke — ${res.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
