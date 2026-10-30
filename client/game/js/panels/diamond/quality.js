// DEADBALL · THE PICTURE'S QUALITY. What the park draws on each tier, the rungs the view's governor
// steps down through when its frames come slow, and the governor (docs/proposals/deadball-glass2.md,
// Performance).
//
// A phone-class screen (a coarse pointer and a short side under 600 CSS pixels, GLASS's own rule,
// windshield.js GL_TIER) starts on the phone tier, anything else on the full one, and the governor
// takes it down from there, a rung at a time, through what the laptop tier gets: the lens's taps,
// the occlusion at quarter size, two towers' shadows, fewer fans, no multisampling, the city
// without its smoke and the spectacle with half its particles, then the resolution. A phone starts
// as low as the steps go.
//
// The keys are the renderer's (gl/ballpark.js `quality`): dpr, the backing store's device pixels at
// most; msaa; shadows, how many towers cast; ao, the occlusion's size against the frame's (2 half,
// 4 quarter, 0 off); dof, the lens's taps; crowd, the share of the fans drawn; city, the city's own
// lights (2 all, 1 no smoke, 0 no searchlights either); fx, the spectacle (2 all, 1 half the
// particles, 0 only the trails); birds and flashes; light, how the park is lit (1 the floods as
// floods, with their falloff, their size and the field's bounce, gl/ballpark.js floodAtt; 0 the
// park as first tuned, kept to compare against); stands, whether the park's own structure, its
// roof and the ball cast the towers' shadows as well as the players; detail, the players' level of
// detail (2 by how tall each stands on the screen, gl/ballpark.js lodOf; 1 a level coarser); fans,
// the crowd's figure (2 the near one through a long lens, gl/ballpark.js CLOSE_FOV; 1 the far one
// always); cards, whether a fan only a few pixels tall is drawn as a card (gl/ballpark.js
// splitCrowd), two triangles to the figure's 256; ink, the cel outline round the players
// (gl/cel-figure.js), a second draw of every body, which the phone goes without; clouds, the
// weather cells marched overhead (gl/cloudvol.js), which the phone also goes without.
//
// Pure: no DOM and no GL.

export const PARK_TIERS = Object.freeze({
  full: Object.freeze({ dpr: 2, msaa: true, shadows: 4, ao: 2, dof: 28, crowd: 1, city: 2, fx: 2, birds: true, flashes: true, light: 1, stands: true, detail: 2, fans: 2, cards: true, ink: true, clouds: true }),
  laptop: Object.freeze({ dpr: 1.5, msaa: true, shadows: 2, ao: 4, dof: 12, crowd: 0.6, city: 1, fx: 1, birds: true, flashes: true, light: 1, stands: true, detail: 2, fans: 1, cards: true, ink: true, clouds: true }),
  phone: Object.freeze({ dpr: 1, msaa: false, shadows: 0, ao: 0, dof: 0, crowd: 0.3, city: 0, fx: 0, birds: false, flashes: false, light: 1, stands: false, detail: 1, fans: 1, cards: true, ink: false, clouds: false }),
});

// The governor's steps down, each over the last, in the plan's order: the lens to 12 taps, the
// clouds off, the stands' near figures off, the occlusion to quarter size, the shadows to two towers and then only the players casting them, the
// crowd to three fans in five, the players drawn a level coarser, the multisampling off, the
// laptop's city and spectacle (no smoke, half the particles), then the resolution a step at a time.
export const PARK_STEPS = Object.freeze([
  { dof: 12 }, { clouds: false }, { fans: 1 }, { ao: 4 }, { shadows: 2 }, { stands: false }, { crowd: 0.6 }, { detail: 1 }, { msaa: false }, { city: 1, fx: 1 }, { dpr: 1.5 }, { dpr: 1.25 }, { dpr: 1 },
].map(Object.freeze));

// What a value costs, so a step is taken only where it's cheaper than what the rung already has.
const cost = (k, v) => (k === 'ao' ? (v ? 1 / (v * v) : 0) : typeof v === 'boolean' ? (v ? 1 : 0) : +v || 0);

// The tier a screen starts on: 'phone' or 'full'. `env` { coarse (a coarse pointer), shortSide (CSS
// pixels), stored (the localStorage key 'architect_gl_tier', 'full' to opt out of the phone tier) }.
export function parkTier(env = {}) {
  if (env.stored === 'full') return 'full';
  return env.coarse && env.shortSide > 0 && env.shortSide < 600 ? 'phone' : 'full';
}

// The rungs for a tier: the tier itself, then each step that takes something off it.
export function rungsFor(tier) {
  const out = [{ ...(PARK_TIERS[tier] || PARK_TIERS.full) }];
  for (const s of PARK_STEPS) {
    const prev = out[out.length - 1], next = { ...prev };
    let cheaper = false;
    for (const [k, v] of Object.entries(s)) if (cost(k, v) < cost(k, prev[k])) { next[k] = v; cheaper = true; }
    if (cheaper) out.push(next);
  }
  return out.map(Object.freeze);
}

// A kind of fan's seats (`stride` floats a fan) dealt into a seeded order, the same on every TV, so
// drawing the first of them at a tier's `crowd` share thins every stand evenly instead of emptying
// the back rows. Returns a new array holding every fan once.
export function dealFans(a, stride) {
  const n = Math.floor(a.length / stride), order = Array.from({ length: n }, (_, i) => i);
  let s = 0x2545f491 >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const out = new Float32Array(n * stride);
  order.forEach((from, to) => out.set(a.subarray(from * stride, from * stride + stride), to * stride));
  return out;
}

// The governor follows the real time between frames, not the time spent in our own code: most of
// a frame is the GPU's, which no timer here sees (gameday-rink.js does the same). Fed each frame's
// interval in seconds, it steps down a rung once frames have averaged slower than `slow` ms for
// `down` s, and back up after `up` s of frames quicker than `quick`; each time it comes back up to
// a rung, the next return to it waits twice as long, so a machine that can only just hold a rung
// doesn't see it change every few seconds. An interval over `gap` s isn't a frame (a hidden tab,
// a stall building bodies, the first frame after a rest) and starts the count again.
export const GOVERNOR = Object.freeze({ slow: 24, quick: 18, down: 1.2, up: 8, gap: 0.1 });

export function createGovernor(rungs, o = GOVERNOR) {
  let rung = 0, avg = 0, slow = 0, quick = 0;
  const wait = rungs.map(() => o.up);
  return {
    get rung() { return rung; },
    get rungs() { return rungs.length; },
    get quality() { return rungs[rung]; },
    // a frame `dt` s after the last: the rung's quality when it changes, else null
    frame(dt) {
      if (!(dt > 0) || dt > o.gap) { slow = quick = 0; return null; }
      const ms = dt * 1000;
      avg = avg ? avg * 0.9 + ms * 0.1 : ms;
      if (avg > o.slow) { slow += dt; quick = 0; } else if (avg < o.quick) { quick += dt; slow = 0; } else { slow = quick = 0; }
      if (slow > o.down && rung < rungs.length - 1) {
        rung++; slow = quick = 0; avg = 0;
        return rungs[rung];
      }
      if (quick > wait[rung - 1] && rung > 0) {
        rung--; slow = quick = 0; avg = 0;
        // should it have to leave this rung again, it waits longer before coming back
        wait[rung] *= 2;
        return rungs[rung];
      }
      return null;
    },
    reset() { rung = 0; avg = slow = quick = 0; wait.fill(o.up); },
  };
}
