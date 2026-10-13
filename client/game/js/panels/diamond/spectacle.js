/**
 * DEADBALL — the spectacle.
 *
 * What a play earns besides itself (docs/proposals/deadball-glass2.md, The look): a comet's
 * tail on a ball hit hard and on every home run, sparks off the bat at hard contact, and
 * fireworks over the outfield once a home run is in the seats or a walk-off is home. Planned
 * here from the play, each effect a time and a place, and drawn by gl/spectacle.js. Pure in
 * time, so a frame at any moment (the sandbox's stopped clock, a replay) draws the same thing.
 *
 * A particle's way is worked out the same here and in the vertex shader: from its template (a
 * direction and three factors, TEMPLATES, uploaded once), the effect's kind, its origin and how
 * long it's been going (`particleAt`, and PARTICLE_GLSL in gl/spectacle.js). The gate holds the
 * JS one to where the bursts should be; the sandbox shows the GLSL.
 *
 * Reduced motion leaves all of it out. With it on, the shells go up at least BEAT apart, so they
 * never flash more than three times a second.
 *
 * Pure: no DOM and no GL.
 */

import { DEG, seeded } from './geo.js';
import { fenceAt, sprayOf } from './play.js';

// Off the bat this hard (mph), a ball gets the tail and the sparks.
export const HARD = 100;

// The particle templates: a direction on the sphere and three factors (speed, life, colour),
// shared by every effect. A burst turns the sphere by its own spin; sparks squeeze it into a
// cone round the ball's way. The sphere's points are dealt out of order (37 steps at a time), so
// an effect that uses the first few still has them all round: in order, the first forty were
// all in the top half.
export const TEMPLATE_N = 96;
export const TEMPLATES = (() => {
  const r = seeded(0x5ba7c1e5), out = new Float32Array(TEMPLATE_N * 6), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < TEMPLATE_N; i++) {
    const j = (i * 37) % TEMPLATE_N, y = 1 - 2 * (j + 0.5) / TEMPLATE_N, rad = Math.sqrt(1 - y * y), ph = j * golden + (r() - 0.5) * 0.5;
    const d = [Math.cos(ph) * rad + (r() - 0.5) * 0.12, y + (r() - 0.5) * 0.12, Math.sin(ph) * rad + (r() - 0.5) * 0.12];
    const l = Math.hypot(d[0], d[1], d[2]);
    out.set([d[0] / l, d[1] / l, d[2] / l, 0.72 + 0.46 * r(), 0.78 + 0.44 * r(), r()], i * 6);
  }
  return out;
})();

// How each kind moves and glows. v: speed (ft/s), drag (1/s), g: gravity (ft/s²), life (s), width
// and streak (its length in seconds of travel) in feet, glow: how far over white it burns.
export const KINDS = Object.freeze({
  sparks: Object.freeze({ n: 40, v: 46, drag: 4.5, g: 32, life: 0.4, width: 0.09, streak: 0.035, glow: 9, spread: 0.55 }),
  burst: Object.freeze({ n: 96, v: 85, drag: 1.4, g: 14, life: 2.2, width: 3.5, streak: 0.12, glow: 7, rise: 0.6 }),
});
// How far apart the shells go up, at least: more than a third of a second, so no second ever has
// more than three bursts in it (the plan's rule on flashing), and up to JITTER more at random.
export const BEAT = 0.34, JITTER = 0.04;
// The shells' colours, in linear light before the glow: red, gold, green, cyan, magenta, silver.
export const SHELLS = Object.freeze([[1, 0.16, 0.1], [1, 0.7, 0.16], [0.25, 1, 0.3], [0.2, 0.75, 1], [1, 0.25, 0.85], [0.95, 0.95, 1]]);

const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Where particle i of effect e is `tau` seconds after it went off: its way along its direction,
// slowed by drag (v(1 - e^-kτ)/k) and falling under gravity against it. A shell's lower half is
// squashed (DOWN), or its sparks fell into the stands still burning. The vertex shader works the
// same sum.
export const DOWN = 0.5;
export function wayAt(e, i, tau) {
  const K = KINDS[e.kind], T = TEMPLATES, o = i * 6;
  let d = [T[o], T[o + 1], T[o + 2]];
  if (e.kind === 'sparks') d = unit([e.dir[0] + d[0] * K.spread, e.dir[1] + d[1] * K.spread, e.dir[2] + d[2] * K.spread]);
  else { const c = Math.cos(e.spin), s = Math.sin(e.spin); d = [c * d[0] + s * d[2], d[1] < 0 ? d[1] * DOWN : d[1], -s * d[0] + c * d[2]]; }
  const v = K.v * T[o + 3] * (e.scale || 1), k = K.drag, ex = Math.exp(-k * tau);
  const along = v * (1 - ex) / k, fall = K.g * (tau / k - (1 - ex) / (k * k));
  return [e.at[0] + d[0] * along, e.at[1] + d[1] * along - fall, e.at[2] + d[2] * along];
}
// Particle i of effect e at time t: { at, glow } while it burns, or null. A burst's shell rises
// from its launch for `rise` seconds first, drawn as particle 0 on its way up.
export function particleAt(e, i, t) {
  const K = KINDS[e.kind], T = TEMPLATES, tau = t - e.t;
  if (e.kind === 'burst') {
    const up = tau + K.rise;
    if (up < 0) return null;
    if (tau < 0) {
      if (i !== 0) return null;
      const u = up / K.rise, ease = 1 - (1 - u) * (1 - u);
      return { at: [e.from[0] + (e.at[0] - e.from[0]) * ease, e.from[1] + (e.at[1] - e.from[1]) * ease, e.from[2] + (e.at[2] - e.from[2]) * ease], glow: K.glow * 0.5 };
    }
  } else if (tau < 0) return null;
  const life = K.life * T[i * 6 + 4];
  if (tau > life) return null;
  const fade = 1 - tau / life;
  return { at: wayAt(e, i, tau), glow: K.glow * fade * fade * (tau < 0.08 ? 1.6 : 1) };
}
// When the last of an effect's particles has gone out.
export const endOf = (e) => (e.kind === 'trail' ? e.to + TRAIL.fade : e.t + KINDS[e.kind].life * 1.22);

// The comet's tail: the last third of a second of the ball's way, head to tail, fading out once
// the flight it's on is over.
export const TRAIL = Object.freeze({ span: 0.32, n: 28, width: 0.55, glow: 4.5, fade: 0.3 });
export function trailAt(e, t) {
  if (t < e.from || t > e.to + TRAIL.fade) return null;
  const head = Math.min(t, e.to), span = Math.min(TRAIL.span, head - e.from);
  if (!(span > 0.01)) return null;
  const pts = [];
  for (let k = 0; k < TRAIL.n; k++) {
    const q = e.path(head - span * k / (TRAIL.n - 1));
    if (q && q.every(Number.isFinite)) pts.push(q);
  }
  const fade = t > e.to ? 1 - (t - e.to) / TRAIL.fade : 1;
  return pts.length > 1 ? { pts, glow: TRAIL.glow * fade * (e.heat || 1) } : null;
}

// ── what a play earns ───────────────────────────────────────────────────────
// `o`: { p (the payload), tBat (contact), at (where the bat met it), path (its flight off the bat,
// with `.land` its time down), end (when that flight's over: the catch or the pick-up), landAt
// (the play lands), motion (false: reduced motion) }. Anything missing and its effect is left
// out. Returns the effects, each { kind, … }.
export function planSpectacle(o) {
  const p = o.p || {}, pl = p.play || null, fx = [];
  const rand = seeded(hashOf(`${p.batter}|${p.inning}|${p.half}|${p.kind}|spectacle`));
  const hr = p.kind === 'homerun', ev = Number(pl?.ev) || 0, motion = o.motion !== false;
  const path = o.path && typeof o.path === 'function' ? o.path : null;
  // a viewer who's asked for less motion gets none of it
  if (!motion) return fx;
  if (path && Number.isFinite(o.tBat) && (hr || ev >= HARD)) {
    // a home run's to the seats; another until it's down or caught, a second and a half at most
    const down = Number.isFinite(path.land) ? path.land : o.tBat + 1.5, end = Number.isFinite(o.end) ? o.end : Infinity;
    fx.push({ kind: 'trail', from: o.tBat, to: hr ? Math.min(down, end) : Math.min(down, end, o.tBat + 1.5), path, heat: 0.8 + 0.4 * Math.min(1, Math.max(0, (ev - 95) / 20)) });
    if (ev >= HARD && Array.isArray(o.at)) {
      const a = path(o.tBat), b = path(o.tBat + 0.02);
      fx.push({ kind: 'sparks', t: o.tBat, at: o.at.slice(), dir: unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), seed: rand() });
    }
  }
  if (hr || p.walkoff) {
    // over the outfield, leaning the way it went (centre on a walk-off without one), each shell up
    // from behind the bleachers and bursting over them, a third of a second or so apart; the wide
    // shot over the outfield (camera.js sky) frames them, and round where a ball down a line came
    // down they bunched at its edge
    const landed = hr && path && Number.isFinite(path.land) ? path(path.land) : null;
    const centre = landed ? sprayOf(landed) * 0.5 : 0, start = landed ? path.land + 0.15 : (o.landAt ?? 0) + 0.2;
    const n = p.walkoff ? 12 : hr && (p.rbi | 0) >= 4 ? 9 : 6, spread = p.walkoff ? 70 : 60;
    const colour = Math.floor(rand() * SHELLS.length);
    for (let k = 0; k < n; k++) {
      const dir = Math.max(-40, Math.min(40, centre + spread * ((n > 1 ? k / (n - 1) : 0.5) - 0.5) + (rand() - 0.5) * 8));
      const r = fenceAt(dir) + 50 + 30 * rand(), y = 88 + 30 * rand();
      const at = [-Math.sin(dir * DEG) * r, y, Math.cos(dir * DEG) * r], from = [-Math.sin(dir * DEG) * (r + 14), 28, Math.cos(dir * DEG) * (r + 14)];
      fx.push({ kind: 'burst', t: start + KINDS.burst.rise + (BEAT + JITTER / 2) * k + JITTER / 2 * rand(), at, from, spin: rand() * Math.PI * 2, scale: 0.85 + 0.35 * rand(),
        colour: SHELLS[(colour + k) % SHELLS.length], second: SHELLS[(colour + k + 2) % SHELLS.length] });
    }
  }
  return fx;
}

// A string's hash as a seed (FNV-1a), so the same play always gets the same show.
function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ── the words a play earns ──────────────────────────────────────────────────
// The splash a play earns on the picture beyond the broadcast's own cards (the server throws the
// home run, the walk-off and the double and triple plays): { kind, sub } for hud.js's splash, its
// words by kind in the HUD's theme, or null. The fielder is named by where he plays; the payload
// names nobody else in the field.
const POSITION = ['', 'PITCHER', 'CATCHER', 'FIRST BASE', 'SECOND BASE', 'THIRD BASE', 'SHORTSTOP', 'LEFT FIELD', 'CENTER FIELD', 'RIGHT FIELD'];
const IN_THE_AIR = new Set(['flyout', 'popout', 'sacfly']);
const ON_THE_GROUND = new Set(['groundout', 'productout']);
export function splashOf(p) {
  if (!p || p.phase === 'half') return null;
  const pl = p.play || {}, n = pl.f?.[0], by = POSITION[n] || '';
  if (p.phase === 'run') {
    if (p.kind === 'pickoff') return { kind: 'pickoff', sub: p.runner || '' };
    if (p.kind === 'wildpitch') return { kind: 'wildpitch', sub: p.pitcher || '' };
    if (p.kind === 'passedball') return { kind: 'passedball', sub: POSITION[2] };
    return null;
  }
  if (p.kind === 'strikeout') return { kind: 'strikeout', sub: p.pitcher || '' };
  if (p.kind === 'walk') return { kind: 'walk', sub: p.batter || '' };
  if (p.kind === 'hitbypitch') return { kind: 'hitbypitch', sub: p.batter || '' };
  if (p.kind === 'triple') return { kind: 'triple', sub: p.batter || '' };
  if (p.kind === 'error') return { kind: 'error', sub: [n ? `E${n}` : '', by].filter(Boolean).join(' · ') };
  if (IN_THE_AIR.has(p.kind)) {
    // up at the wall, and over it if it was going out
    if (pl.g === 'leaping') return { kind: Number(pl.d) > fenceAt(Number(pl.dir) || 0) ? 'robbed' : 'wallcatch', sub: by };
    if (pl.g === 'diving') return { kind: 'divingcatch', sub: by };
    if (pl.g === 'sliding') return { kind: 'slidingcatch', sub: by };
    if (pl.g === 'rail') return { kind: 'railcatch', sub: by };
  }
  if (ON_THE_GROUND.has(p.kind)) {
    if (pl.g === 'diving') return { kind: 'divingstop', sub: by };
    if (pl.g === 'barehand') return { kind: 'barehand', sub: by };
  }
  return null;
}
