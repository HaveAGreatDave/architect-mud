// cabgps — an EMP takes the nav head, and a dead screen stops EMITTING.
//
//   node scripts/shapes/cabgps.mjs
//   node scripts/shapes/cabgps.mjs --detail
//
// ⚠ THE FAILURE THIS EXISTS FOR IS A SCREEN THAT LOOKS BROKEN AND IS NOT. The obvious way to write
// "the GPS is dead" is to skip the map and leave the rest of `drawCabGps` running — and everything
// after the map in that function is the unit EMITTING: a scanline wash and, far more so, a
// two-pass BACKLIGHT that lifts the whole display in its own phosphor colour. Leave those in and
// what the driver gets is a softly glowing teal rectangle with nothing on it, which reads as a GPS
// that has lost its FIX rather than one that has lost its POWER. Those are different states with
// different next actions, and the renderer has to be able to say which.
//
// ⚠ AND `shapes:smoke` CANNOT ANSWER IT. That one proves a painter runs without throwing; a
// backlight painted over an empty map runs perfectly. This needs a context that counts, and in
// particular one that records GRADIENT STOPS — the backlight is two gradients and the dead-glass
// smear is one, so a harness that only counted calls would see "three fills either way" and pass.
//
// ⚠ IT ALSO GUARDS THE SAVE/RESTORE BALANCE, which is the other thing an early return out of the
// middle of a clipped, transformed block gets wrong. Two saves are open at that point. Leave one,
// and the clip and the rotation leak into everything drawn after the GPS for the rest of the frame
// — a defect that shows up nowhere near the thing that caused it.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');
const W = 640, H = 360;
let fails = 0, checks = 0;
const check = (name, ok, note) => {
  checks++;
  if (!ok) { fails++; console.log(`  ✗ ${name}${note ? ' — ' + note : ''}`); }
  else if (DETAIL) console.log(`  ✓ ${name}${note ? ' — ' + note : ''}`);
};

// The counting context, same shape cabtrinkets uses and for the same reasons — see its header for
// why gradients have to record their stops and why there is exactly one tally for the whole run.
const INK = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'putImageData']);
const styleOf = (v) => (typeof v === 'string' ? v : v && v.stops ? 'grad[' + v.stops.join(',') + ']' : '~');
function countingCtx(tally) {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: W, height: H };
      if (k === 'measureText') return (txt) => ({ width: String(txt ?? '').length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') {
        return () => ({ stops: [], addColorStop(o, c) { this.stops.push(o + '@' + c); } });
      }
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const w2 = Math.max(1, w | 0), h2 = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 };
      };
      // ⚠ THE BALANCE IS COUNTED HERE, not inferred from the trace. save/restore move the pen and
      // put no ink down, so they are deliberately outside INK — but an unbalanced pair is exactly
      // what an early return out of a clipped block gets wrong, so they are tallied separately.
      if (k === 'save') return () => { tally.save++; };
      if (k === 'restore') return () => { tally.restore++; };
      if (INK.has(k)) return (...a) => {
        tally.n++;
        const st = k.startsWith('stroke') || k === 'stroke' ? t.strokeStyle : t.fillStyle;
        tally.log.push(k + ':' + styleOf(st));
      };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const ws = await loadWindshield();

const ID = '__cab-gps';
const el = stubCanvas(ID, W, H);
// ⚠ THE DASH IS ITS OWN CANVAS. `paintCabDash` opens with `getElementById(id + '-dash')` and
// returns on that line when it finds nothing — so a harness that registers only the world canvas
// never runs one pixel of the interior and reports every claim here as passing. cabtrinkets'
// header records this as the one false negative that was not its own fault; it is the same trap.
stubCanvas(ID + '-dash', W, H);
const TALLY = { n: 0, log: [], save: 0, restore: 0 };
const CTX = countingCtx(TALLY);
el.getContext = () => CTX;
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (t) => {
  const e = realCreate(t);
  if (String(t).toLowerCase() === 'canvas') e.getContext = () => CTX;
  return e;
};

const R = 10, N = R * 2 + 1;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  x === R ? { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 }
    : { kind: 'land', biome: 'citycore', flr: 0 }
)));

// Pinned, so two paints of the same scene are comparable — the GPS has a boot animation on its own
// clock and a drifting one would make every count a different count.
const realNow = performance.now.bind(performance);
performance.now = () => 1000;

function paint(elecOut) {
  TALLY.n = 0; TALLY.log.length = 0; TALLY.save = 0; TALLY.restore = 0;
  ws.paintWindshield(ID, {
    map, cls: 'truck', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12,
    hour: 13, weather: 'clear', speed: 0.3, heading: 0, tier: 2, variant: 'rigid',
    mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
    resFloor: 1, perfDS: 0,
    ...(elecOut ? { elecOut: true } : {}),
  });
  return { n: TALLY.n, log: TALLY.log.slice(), save: TALLY.save, restore: TALLY.restore };
}

console.log('cabgps — a cooked nav head draws dead glass, not a lit blank screen');

// First paint fills the texture/pattern/shape caches; the second is the steady state.
paint(false);
const live = paint(false);
const dead = paint(true);

// The rectangle the cab hit-tests a tap against. It has to survive: the tablet still opens on a
// dead unit (and says NO SIGNAL), because pressing a dead screen is what a person does.
check('the GPS still reports its rectangle when dead', !!ws.cabGpsRect(), String(ws.cabGpsRect()));

// ── The backlight is the claim ───────────────────────────────────────────────
// Two gradients in the display's own phosphor colour plus a vignette. They are identified by their
// STOPS rather than by a call count, because the dash is full of gradients and only these carry
// that colour — see the header.
const phosphor = (t) => t.log.filter(s => /grad\[.*96,196,178|grad\[.*110,206,186|grad\[.*84,178,166/.test(s)).length;
check('a live GPS is backlit', phosphor(live) > 0, `${phosphor(live)} phosphor fill(s)`);
check('a cooked GPS emits nothing', phosphor(dead) === 0, `${phosphor(dead)} phosphor fill(s)`);

// ⚠ AND IT IS NOT SIMPLY DRAWING LESS. A unit that vanished entirely would pass the line above and
// be a hole cut in the dash. The dead glass is a real surface and puts real ink down.
check('…but the glass is still drawn', dead.n > 0, `${dead.n} marks`);
check('…and a dead unit costs less ink than a live one', dead.n < live.n, `${dead.n} vs ${live.n}`);

// ── The early return does not leak its clip ──────────────────────────────────
check('save/restore stays balanced with the screen live', live.save === live.restore, `${live.save}/${live.restore}`);
check('…and with it dead', dead.save === dead.restore, `${dead.save}/${dead.restore}`);

performance.now = realNow;

console.log(fails
  ? `✗ cabgps — ${fails} of ${checks} claim(s) failed.`
  : `✓ cabgps — ${checks} claims hold (live ${live.n} marks, dead ${dead.n}).`);
process.exit(fails ? 1 : 0);
