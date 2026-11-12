// CHEM CHAIN: the stages of a cook at the Chem Stage, as pure simulations (docs/proposals/chem-stage.md,
// phases 2 and 3).
//
// A cook is a chain of short stages picked by the drug's form: a liquid is measured, heated, refluxed,
// separated and evaporated; a powder is weighed and ground, and a pill is pressed as well; a crystal is
// dissolved hot, crystallised and filtered; a gas is regulated, leak-tested and collected; a leaf is
// dried and cured; a splice is measured, stirred, heated and set. Each stage is a small
// sim stepped by time and a semantic input (pour, dial, flow...), and scores 0..100. The chain's
// score is their mean, rounded, and it's the one score `synthresolve` already takes, so the server's
// ±2 cap and its chemistry check are untouched. A neutral hand scores about 50, which is a bonus of 0.
//
// ⚠ NO WALL CLOCK, NO Math.random, NO DOM. A stage is a function of its seed, the difficulty and the
// inputs it's stepped with, so scripts/shapes/chem-stage-smoke.mjs plays every stage in Node with a
// good hand and a bad one and checks what they score.
//
// ⚠ NO COUNTDOWN ON THE HEAT. What a stage shows is what the bench shows: a thermometer with its mark,
// a line on a cylinder, a scale's readout. A stage's `view` is what the renderer may draw; nothing in
// it is a timer to the right moment.

// Which stages a form plays. Every form has a chain; `splice` is the master-tier splice's, which
// the server sends as its own kind rather than a form.
const WET = ['measure', 'heat', 'reflux', 'separate', 'evaporate'];
export const CHAINS = Object.freeze({
  liquid: WET, gel: WET, paste: WET,
  powder: ['weigh', 'grind'],
  pill: ['weigh', 'grind', 'press'],
  crystal: ['heat', 'crystallise', 'filter'],
  gas: ['regulate', 'leak', 'collect'],
  leaf: ['dry', 'cure'],
  blotter: ['measure', 'dry'],
  splice: ['measure', 'stir', 'heat', 'rhythm'],
});
// With no form, the family's: the server always sends a family, and an unformed drug cooks wet.
const BY_FAMILY = { wet: 'liquid', solids: 'powder', gas: 'gas', botanical: 'leaf', splice: 'splice' };
export function chainFor(family, form) {
  if (form && !CHAINS[form]) return null;
  const f = CHAINS[form] ? form : BY_FAMILY[family];
  return f ? CHAINS[f].slice() : null;
}
// The 2-D splice's stage keys (plugins/synthesis SPLICE_STAGES) that an automation rig can carry, as the
// Stage's: an automated stage is skipped at the rig's score.
export const SPLICE_RIG = Object.freeze({ charge: 'measure', mix: 'measure', pour: 'measure', stir: 'stir', heat: 'heat', rhythm: 'rhythm' });

// How forgiving a stage is at a difficulty (server cookDiff: 4 for tier 1 up to 12 for tier 5):
// 1 at the easiest, about 0.47 at the hardest. Bands and windows are multiplied by it.
export const tolOf = (difficulty = 6) => Math.max(0.45, Math.min(1, 1.25 - Number(difficulty) * 0.065));

export function rngOf(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// 100 inside `full`, falling straight to 0 at `zero`
const ramp = (err, full, zero) => (err <= full ? 100 : err >= zero ? 0 : 100 * (1 - (err - full) / (zero - full)));

// ── the stages ──────────────────────────────────────────────────────────────────────────────────────
// Each is { label, hint, make(rng, tol) → state, step(state, input, dt), done(state), score(state) }.
export const STAGES = {
  // Pour a reagent into a measuring cylinder to its line. Holding tips the bottle further, so the
  // stream grows; letting go rights it, and what's in the neck still runs out.
  measure: {
    label: 'Measure', hint: 'Hold to pour. Stop at the line.',
    make: (r, tol) => ({ t: 0, tol, target: 0.45 + r() * 0.35, level: 0, tip: 0, flow: 0, poured: false, idle: 0, over: false }),
    step(s, i, dt) {
      s.t += dt;
      s.tip = clamp(s.tip + (i.pour ? 1.6 : -3) * dt);
      s.flow = Math.pow(Math.max(0, (s.tip - 0.25) / 0.75), 1.5) * 0.24;
      s.level += s.flow * dt;
      if (s.flow > 0) s.poured = true;
      s.idle = !i.pour && s.flow === 0 ? s.idle + dt : 0;
      if (s.level >= 1) { s.level = 1; s.over = true; }
    },
    done: (s) => s.over || s.t >= 16 || (s.poured && s.idle >= 0.6),
    score: (s) => (s.over ? 0 : ramp(Math.abs(s.level - s.target), 0.025 * s.tol + 0.008, 0.25)),
    view: (s) => ({ level: s.level, target: s.target, tip: s.tip, flow: s.flow }),
  },
  // Bring it to temperature on the hotplate and hold it there. The dial sets the power; the liquid
  // follows it slowly, so you lead it. Past the boil it boils over.
  heat: {
    label: 'Heat', hint: 'Drag up and down to set the dial. Hold the mercury on the mark.',
    make: (r, tol) => ({ t: 0, tol, dur: 16, warm: 3, target: 0.55 + r() * 0.2, band: 0.045 * tol + 0.02, temp: 0.05, dial: 0, inBand: 0, over: 0 }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.dial)) s.dial = clamp(i.dial);
      s.temp += (s.dial * 1.05 - s.temp) * (1 - Math.exp(-dt / 2.2));
      if (s.temp > 0.92) s.over += dt;
      if (s.t > s.warm && Math.abs(s.temp - s.target) <= s.band) s.inBand += dt;
    },
    done: (s) => s.t >= s.dur,
    score: (s) => clamp(100 * Math.pow(s.inBand / (s.dur - s.warm), 0.8) - s.over * 25, 0, 100),
    view: (s) => ({ temp: s.temp, target: s.target, band: s.band, dial: s.dial, boiling: s.temp > 0.85 ? 1 : s.temp > 0.6 ? 0.4 : 0 }),
  },
  // Keep the condenser's water running to match the heat, so the ring of condensing vapour stays low
  // in the condenser. Too little water and it climbs out of the top.
  reflux: {
    label: 'Reflux', hint: 'Drag up and down for more or less water. Keep the ring low.',
    make: (r, tol) => ({ t: 0, tol, dur: 15, p1: r() * 6.28, p2: r() * 6.28, w1: 0.5 + r() * 0.4, w2: 1.3 + r() * 0.6, heat: 0.5, flow: 0, ring: 0.2, hi: 0.4 * tol + 0.18, inBand: 0, lost: 0 }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.flow)) s.flow = clamp(i.flow);
      s.heat = clamp(0.5 + 0.25 * Math.sin(s.t * s.w1 + s.p1) + 0.1 * Math.sin(s.t * s.w2 + s.p2));
      s.ring = clamp(s.ring + (s.heat - s.flow) * 0.9 * dt, 0, 1.05);
      if (s.ring >= 1) s.lost += dt;
      if (s.ring >= 0.1 && s.ring <= s.hi) s.inBand += dt;
    },
    done: (s) => s.t >= s.dur,
    score: (s) => clamp(100 * (s.inBand / s.dur) * 1.15 - s.lost * 30, 0, 100),
    view: (s) => ({ ring: s.ring, flow: s.flow, heat: s.heat, hi: s.hi }),
  },
  // Boil it down and take it off the heat when it's just dry. Early is wet; late scorches.
  evaporate: {
    label: 'Evaporate', hint: 'Click to take it off the heat when it\'s just dry.',
    make: (r, tol) => { const rate = 0.09 + r() * 0.03; return { t: 0, tol, rate, vol: 1, dryAt: 0.92 / rate, stopped: null, win: 0.5 + 0.8 * tol }; },
    step(s, i, dt) {
      if (s.stopped !== null) return;
      s.t += dt;
      s.vol = Math.max(0, 1 - s.rate * s.t);
      if (i.stop) s.stopped = s.t;
    },
    done: (s) => s.stopped !== null || s.t >= s.dryAt + 4,
    score: (s) => ramp(Math.abs((s.stopped ?? s.t) - s.dryAt), s.win * 0.4, s.win * 2.9),
    // what the dish shows, by beat: wet while it's boiling, dry once the crust has formed, scorched after
    view: (s) => { const t = s.stopped ?? s.t; return { vol: Math.max(0.08, s.vol), beat: t < s.dryAt - s.win * 0.4 ? 'wet' : t <= s.dryAt + s.win * 0.6 ? 'dry' : 'scorch', boiling: s.stopped === null && t < s.dryAt ? 1 : 0 }; },
  },
  // Spoon a powder onto the scale to a weight. Holding tips the spatula and the powder runs faster;
  // what's already falling still lands after you let go.
  weigh: {
    label: 'Weigh', hint: 'Hold to tip the spatula. Stop on the weight.',
    make: (r, tol) => ({ t: 0, tol, target: Math.round((2 + r() * 6) * 100) / 100, mass: 0, tip: 0, falling: 0, jit: r() * 6.28, poured: false, idle: 0 }),
    step(s, i, dt) {
      s.t += dt;
      s.tip = clamp(s.tip + (i.tip ? 1.4 : -4) * dt);
      const rate = Math.pow(Math.max(0, (s.tip - 0.2) / 0.8), 1.3) * 1.6 * (1 + 0.25 * Math.sin(s.t * 9 + s.jit));
      s.falling += rate * dt;
      const land = Math.min(s.falling, s.falling * dt * 6 + 0.002);
      s.falling -= land; s.mass += land;
      if (rate > 0) s.poured = true;
      s.idle = !i.tip && s.falling < 0.003 ? s.idle + dt : 0;
    },
    done: (s) => s.t >= 16 || s.mass > s.target * 1.6 || (s.poured && s.idle >= 0.8),
    score: (s) => ramp(Math.abs(s.mass + s.falling - s.target) / s.target, 0.02 * s.tol + 0.005, 0.3),
    view: (s) => ({ mass: s.mass, target: s.target, tip: s.tip, falling: s.falling }),
  },
  // Grind in the mortar: circle the pestle while you hold. Too fast and it flies out of the bowl.
  grind: {
    label: 'Grind', hint: 'Hold and circle the pestle round the bowl. Not too fast.',
    make: (r, tol) => ({ t: 0, tol, fine: 0, spill: 0, angle: null, speed: 0, max: 7 + 4 * tol }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.angle) && s.angle !== null && i.press) {
        let d = i.angle - s.angle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const w = Math.abs(d) / Math.max(dt, 1e-3);
        s.speed = s.speed * 0.8 + w * 0.2;
        s.fine = clamp(s.fine + Math.abs(d) * 0.035 * (1 - s.fine * 0.4));
        if (s.speed > s.max) s.spill = clamp(s.spill + (s.speed - s.max) * dt * 0.03, 0, 0.5);
      } else s.speed *= 0.8;
      if (Number.isFinite(i.angle)) s.angle = i.angle;
    },
    done: (s) => s.fine >= 1 || s.t >= 14,
    score: (s) => clamp(100 * Math.min(1, s.fine / 0.9) - s.spill * 250, 0, 100),
    view: (s) => ({ fine: s.fine, spill: s.spill, angle: s.angle ?? 0, fast: s.speed > s.max }),
  },
  // Press three tablets: hold to bring the punch down, let go when the force is on the mark. Too hard
  // and the tablet cracks.
  press: {
    label: 'Press', hint: 'Hold to press. Let go on the mark. Three tablets.',
    make: (r, tol) => ({ t: 0, tol, n: 3, made: [], force: 0, held: false, mark: 0.6 + r() * 0.15, band: 0.06 * tol + 0.03 }),
    step(s, i, dt) {
      s.t += dt;
      if (s.made.length >= s.n) return;
      if (i.press) { s.held = true; s.force = Math.min(1.05, s.force + dt * 0.75 * (1 + s.force)); }
      if ((!i.press && s.held) || s.force >= 1.05) {
        const e = Math.abs(s.force - s.mark);
        s.made.push(s.force >= 1.05 ? 0 : ramp(e, s.band, s.band * 4));
        s.force = 0; s.held = false;
      }
    },
    done: (s) => s.made.length >= s.n || s.t >= 24,
    score: (s) => { const m = s.made.concat(Array(Math.max(0, s.n - s.made.length)).fill(0)); return m.reduce((a, b) => a + b, 0) / s.n; },
    view: (s) => ({ force: s.force, mark: s.mark, band: s.band, made: s.made.slice(), n: s.n }),
  },
  // Run off the bottom layer through the stopcock and shut it at the line between the two. Shut early
  // and some of the bottom layer stays in; late and you lose some of the top.
  separate: {
    label: 'Separate', hint: 'Hold to open the tap. Shut it where the two layers meet.',
    make: (r, tol) => ({ t: 0, tol, lower: 0.42 + r() * 0.16, upper: 0.32 + r() * 0.1, lost: 0, open: 0, opened: false, idle: 0 }),
    step(s, i, dt) {
      s.t += dt;
      s.open = i.open ? Math.min(1, s.open + dt * 3) : 0;
      let out = s.open * 0.075 * dt;
      if (out > 0) s.opened = true;
      const fromLower = Math.min(s.lower, out); s.lower -= fromLower; out -= fromLower;
      const fromUpper = Math.min(s.upper, out); s.upper -= fromUpper; s.lost += fromUpper;
      s.idle = !i.open ? s.idle + dt : 0;
    },
    done: (s) => s.t >= 20 || s.lost > 0.15 || (s.opened && s.idle >= 0.6),
    score: (s) => ramp(s.lower + s.lost * 1.5, 0.01 * s.tol + 0.004, 0.12),
    view: (s) => ({ lower: s.lower, upper: s.upper, open: s.open }),
  },
  // Cool a hot, saturated solution so the crystals grow slowly: big and clear. Too fast and they come
  // out as a cloudy crust; too slow and the time runs out before it's crystallised.
  crystallise: {
    label: 'Crystallise', hint: 'Drag to set how hard it cools. Slow and steady grows them big.',
    make: (r, tol) => ({ t: 0, tol, temp: 1, cool: 0, rate: 0, good: 0, warm: 0, cloud: 0, aim: 0.05 + r() * 0.015, band: 0.016 * tol + 0.008, seed: r() }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.dial)) s.cool = clamp(i.dial);
      // the rate eases toward what the setting gives, as a dish does
      s.rate += (0.008 + s.cool * 0.12 - s.rate) * (1 - Math.exp(-dt / 0.8));
      s.temp = Math.max(0, s.temp - s.rate * dt);
      if (s.temp > 0.25) { s.warm += dt; if (Math.abs(s.rate - s.aim) <= s.band) s.good += dt; else if (s.rate > s.aim) s.cloud = clamp(s.cloud + (s.rate - s.aim) * dt * 4); }
    },
    done: (s) => s.temp <= 0.2 || s.t >= 22,
    score: (s) => clamp(100 * Math.min(1, (s.good / Math.max(1, s.warm)) * 1.12) * (s.temp <= 0.3 ? 1 : 0.5), 0, 100),
    view: (s) => ({ temp: s.temp, cool: s.cool, rate: s.rate, grown: clamp((1 - s.temp) / 0.8), size: clamp(s.good / 10), cloud: s.cloud, seed: s.seed }),
  },
  // Pour the slurry onto the Buchner funnel as the vacuum pulls it through: keep it wet. Over the rim
  // and you lose it; let it run dry before the end and the cake cracks.
  filter: {
    label: 'Filter', hint: 'Hold to pour. Keep the funnel wet, never over the rim.',
    make: (r, tol) => ({ t: 0, tol, poured: 0, level: 0, tip: 0, over: 0, crack: 0, pull: 0.08 + r() * 0.03, top: 0.92 }),
    step(s, i, dt) {
      s.t += dt;
      s.tip = clamp(s.tip + (i.pour ? 2 : -3.5) * dt);
      const flow = s.poured < 1 ? Math.max(0, (s.tip - 0.2) / 0.8) * 0.3 * dt : 0;
      s.poured = Math.min(1, s.poured + flow);
      s.level = Math.max(0, s.level + flow * 1.6 - s.pull * dt);
      if (s.level > s.top) { s.over += s.level - s.top; s.level = s.top; }
      if (s.poured > 0.05 && s.poured < 0.98 && s.level < 0.04) s.crack += dt * (1.6 - s.tol);
    },
    done: (s) => s.t >= 24 || (s.poured >= 0.98 && s.level <= 0.001),
    score: (s) => clamp(100 - s.over * 220 - s.crack * 18 - (1 - s.poured) * 120, 0, 100),
    view: (s) => ({ poured: s.poured, level: s.level, tip: s.tip, crack: s.crack, cake: s.poured - s.level * 0.3 }),
  },
  // Set the regulator so the gauge sits in the green as the bottle empties under you. Past the red the
  // relief valve blows.
  regulate: {
    label: 'Regulate', hint: 'Drag to set the regulator. Keep the needle in the green.',
    make: (r, tol) => ({ t: 0, tol, dur: 14, dial: 0, p: 0, target: 0.5 + r() * 0.2, band: 0.05 * tol + 0.025, inBand: 0, pops: 0, popT: 0, ph: r() * 6.28 }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.dial)) s.dial = clamp(i.dial);
      const supply = 1.1 - 0.45 * Math.min(1, s.t / s.dur);
      s.p += (s.dial * supply - s.p) * (1 - Math.exp(-dt / 0.5));
      const shown = s.p + wobble(s);
      if (s.t > 1.5 && Math.abs(shown - s.target) <= s.band) s.inBand += dt;
      if (shown > 0.95 && s.popT <= 0) { s.pops++; s.popT = 1; s.p *= 0.6; }
      s.popT -= dt;
    },
    done: (s) => s.t >= s.dur,
    score: (s) => clamp(100 * Math.pow(s.inBand / (s.dur - 1.5), 0.8) - s.pops * 20, 0, 100),
    view: (s) => ({ p: s.p + wobble(s), target: s.target, band: s.band, dial: s.dial, popping: s.popT > 0, supply: 1.1 - 0.45 * Math.min(1, s.t / s.dur) }),
  },
  // Brush soapy water on the joints until one bubbles, then hold on it to tighten it. Not too long: a
  // fitting turned past tight strips.
  leak: {
    label: 'Leak test', hint: 'Click a joint to brush it. Hold on the one that bubbles to tighten it.',
    make: (r, tol) => ({ t: 0, tol, n: 4, leak: Math.floor(r() * 4), brushed: [false, false, false, false], tight: 0, fixedAt: null, past: 0, wrong: 0, joint: -1, was: false }),
    step(s, i, dt) {
      s.t += dt;
      const j = Number.isInteger(i.joint) && i.joint >= 0 && i.joint < s.n ? i.joint : -1;
      if (i.down && !s.was && j >= 0) s.brushed[j] = true;
      if (i.down && j >= 0 && s.brushed[j] && s.was) {
        if (j === s.leak) { s.tight = Math.min(1.6, s.tight + dt * 1.2); if (s.tight >= 1 && s.fixedAt === null) s.fixedAt = s.t; if (s.tight > 1) s.past += dt; }
        else s.wrong += dt;
      }
      s.was = !!i.down; s.joint = j;
    },
    done: (s) => s.t >= 22 || (s.fixedAt !== null && !s.was),
    score: (s) => (s.fixedAt === null ? 0 : clamp(100 - Math.max(0, s.fixedAt - 6) * 8 - Math.max(0, s.past - 0.5 * s.tol) * 80 - Math.max(0, s.wrong - 0.6) * 15, 0, 100)),
    view: (s) => ({ brushed: s.brushed.slice(), bubbling: s.brushed[s.leak] && s.tight < 1 ? s.leak : -1, tight: s.tight, joint: s.joint, held: s.was, stripped: s.past > 0.5 * s.tol, n: s.n }),
  },
  // Let the gas into the jar under water until the water's pushed down to the mark.
  collect: {
    label: 'Collect', hint: 'Hold to open the valve. Stop when the water is at the mark.',
    make: (r, tol) => ({ t: 0, tol, target: 0.45 + r() * 0.35, level: 0, tip: 0, flow: 0, poured: false, idle: 0, over: false }),
    step(s, i, dt) { STAGES.measure.step(s, { pour: i.open }, dt); },
    done: (s) => STAGES.measure.done(s),
    score: (s) => STAGES.measure.score(s),
    view: (s) => ({ gas: s.level, target: s.target, open: s.tip, flow: s.flow }),
  },
  // Dry the leaf on the screen: heat it and take it off when it's crisp but still green. Too hot and it
  // browns.
  dry: {
    label: 'Dry', hint: 'Drag to set the heat. Click to take it off when it is crisp but still green.',
    make: (r, tol) => ({ t: 0, tol, heat: 0, wet: 1, scorch: 0, stopped: false, aim: 0.12 + r() * 0.04, band: 0.03 * tol + 0.01 }),
    step(s, i, dt) {
      if (s.stopped) return;
      s.t += dt;
      if (Number.isFinite(i.dial)) s.heat = clamp(i.dial);
      s.wet = Math.max(0, s.wet - (0.012 + s.heat * 0.11) * dt);
      if (s.heat > 0.65) s.scorch = clamp(s.scorch + (s.heat - 0.65) * dt * 0.5);
      if (i.stop) s.stopped = true;
    },
    done: (s) => s.stopped || s.t >= 24 || s.wet <= 0,
    score: (s) => clamp(ramp(Math.abs(s.wet - s.aim), s.band, 0.25) - s.scorch * 120, 0, 100),
    view: (s) => ({ wet: s.wet, heat: s.heat, scorch: s.scorch, aim: s.aim }),
  },
  // Cure in a jar: the humidity climbs, and you burp the jar when the hygrometer's in the window. Early
  // wastes it; late and it moulds. Four times.
  cure: {
    label: 'Cure', hint: 'Click to burp the jar when the needle is in the window. Four times.',
    make: (r, tol) => ({ t: 0, tol, n: 4, h: 0.45, rate: 0.06 + r() * 0.03, win: [0.62, 0.62 + 0.06 * tol + 0.03], burps: [], mould: 0, open: 0, r }),
    step(s, i, dt) {
      s.t += dt;
      s.open = Math.max(0, s.open - dt);
      if (s.burps.length >= s.n) return;
      s.h = Math.min(1, s.h + s.rate * dt);
      if (s.h > 0.82) s.mould += dt;
      const late = s.h >= 0.9;
      if (i.click || late) {
        const [a, b] = s.win, d = s.h < a ? a - s.h : s.h > b ? s.h - b : 0;
        s.burps.push(late ? 0 : ramp(d, 0, 0.18));
        s.h = 0.42; s.open = 0.6; s.rate = 0.06 + s.r() * 0.03;
      }
    },
    done: (s) => s.burps.length >= s.n || s.t >= 40,
    score: (s) => clamp(s.burps.concat(Array(Math.max(0, s.n - s.burps.length)).fill(0)).reduce((a, b) => a + b, 0) / s.n - s.mould * 15, 0, 100),
    view: (s) => ({ h: s.h, win: s.win.slice(), open: s.open, burps: s.burps.slice(), n: s.n, mould: s.mould }),
  },
  // Stir the splice: circle the rod at a steady pace. Too slow and it doesn't take; too fast and it slops.
  stir: {
    label: 'Stir', hint: 'Hold and circle the rod. Keep it steady: not too slow, not too fast.',
    make: (r, tol) => ({ t: 0, tol, dur: 10, angle: null, speed: 0, lo: 4.5 - 1.5 * tol, hi: 6.5 + 2 * tol, inBand: 0, slop: 0 }),
    step(s, i, dt) {
      s.t += dt;
      if (Number.isFinite(i.angle) && s.angle !== null && i.press) {
        let d = i.angle - s.angle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        s.speed = s.speed * 0.85 + (Math.abs(d) / Math.max(dt, 1e-3)) * 0.15;
      } else s.speed *= 0.85;
      if (Number.isFinite(i.angle)) s.angle = i.angle;
      if (s.speed >= s.lo && s.speed <= s.hi) s.inBand += dt;
      if (s.speed > s.hi * 1.4) s.slop += dt;
    },
    done: (s) => s.t >= s.dur,
    score: (s) => clamp(100 * Math.min(1, (s.inBand / (s.dur - 1)) * 1.05) - s.slop * 25, 0, 100),
    view: (s) => ({ angle: s.angle ?? 0, speed: s.speed, lo: s.lo, hi: s.hi, slop: s.slop > 0 }),
  },
  // Set it: the reaction pulses, and you strike on each pulse as the ring closes on the flask. Six.
  rhythm: {
    label: 'Set', hint: 'Click as each ring closes on the flask. Six beats.',
    make: (r, tol) => ({ t: 0, tol, n: 6, period: 0.75 + r() * 0.2, lead: 1.2, hits: [], win: 0.07 * tol + 0.04, struck: -1 }),
    step(s, i, dt) {
      s.t += dt;
      if (s.hits.length >= s.n) return;
      const beat = s.lead + s.hits.length * s.period;
      if (i.click) { const e = Math.abs(s.t - beat); s.hits.push(e <= s.period * 0.45 ? ramp(e, s.win * 0.4, s.win * 2.5) : 0); s.struck = s.t; }
      else if (s.t > beat + s.period * 0.45) s.hits.push(0);
    },
    done: (s) => s.hits.length >= s.n,
    score: (s) => s.hits.reduce((a, b) => a + b, 0) / s.n,
    // how far the ring has closed on the next beat (0 wide open, 1 on the mark), and the strikes so far
    view: (s) => { const beat = s.lead + s.hits.length * s.period; return { close: clamp(1 - (beat - s.t) / s.period, 0, 1.2), hits: s.hits.slice(), n: s.n, flash: s.struck >= 0 && s.t - s.struck < 0.15 }; },
  },
};
// what a regulator's needle shakes by, on the stage's own clock
function wobble(s) { return 0.025 * Math.sin(s.t * 3.1 + s.ph) + 0.015 * Math.sin(s.t * 7.3); }

// A chain played stage by stage: { stage, state, scores[] }. `next` moves on once a stage is done.
// `auto` is { stage: score } for the stages an automation rig handles: they're never played.
export function createChain(names, { seed = 1, difficulty = 6, auto = {} } = {}) {
  const r = rngOf(seed), tol = tolOf(difficulty);
  const C = { names: names.slice(), i: 0, scores: [], tol, r, state: null, auto: { ...auto } };
  C.state = STAGES[names[0]].make(r, tol);
  return C;
}
export const stageOf = (C) => C.names[C.i];
export function stepChain(C, input, dt) {
  if (C.i >= C.names.length) return;
  const S = STAGES[C.names[C.i]];
  S.step(C.state, input || {}, Math.max(0, Math.min(dt, 0.1)));
}
export function stageDone(C) { return C.i < C.names.length && STAGES[C.names[C.i]].done(C.state); }
// Close the stage: record its score and make the next one. True when the chain is over.
export function nextStage(C) {
  if (C.i >= C.names.length) return true;
  const name = C.names[C.i];
  C.scores.push(Math.round(name in C.auto ? C.auto[name] : STAGES[name].score(C.state)));
  C.i++;
  if (C.i < C.names.length) C.state = STAGES[C.names[C.i]].make(C.r, C.tol);
  return C.i >= C.names.length;
}
// The chain's one score: the mean of its stages.
export const chainScore = (scores) => (scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50);
