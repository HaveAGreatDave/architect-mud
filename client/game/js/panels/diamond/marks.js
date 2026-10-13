// DEADBALL · THE MARKS. What the game leaves in the infield dirt, worked out from the staging: the
// pitcher's front foot landing on every pitch, the batter digging his back foot in, and the scar a
// man sliding or diving leaves. Each is a mark as diamond/dirt.js paints it ({ kind, at, dir, pts,
// w, end, seed }) with `t`, when on the world's clock it's made. The director says each one then,
// and the view paints it on the park's own copy of the infield (gl/ballpark.js markDirt), so the
// dirt keeps the game. Grass takes none: the painter only darkens what's dirt already, and a scar
// off the dirt (`onDirt`) isn't sent at all.
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { solvePose } from './rig.js';
import { onOf } from './bodies.js';
import { toPark } from './world.js';
import { onDirt } from './dirt.js';
import { DEG } from './geo.js';

export function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// A foot's mark point, the ball of it (half way from the ankle to the toe), and the way it points.
function footOf(J, S) {
  const a = J['an' + S], t = J['toe' + S];
  return { at: [(a[0] + t[0]) / 2, (a[2] + t[2]) / 2], dir: Math.atan2(t[0] - a[0], t[2] - a[2]) / DEG };
}

// When a delivery's front foot comes down, in the clip's own time: it's keyed for a right-hander,
// whose front foot is his left, and it lands on his last plant before the release.
export function strideTime(clip) {
  const rel = clip?.events?.find((e) => e.kind === 'release')?.t ?? clip?.duration ?? 0;
  let t = null;
  for (const p of clip?.plants || []) if (p.foot === 'L' && p.from <= rel && (t == null || p.from > t)) t = p.from;
  return t;
}
// Where a pitcher's front foot lands, as the world has him placed (`slot`), and when in `clip`:
// { tau, at, dir }, or null. A left-hander's front foot is his right.
export function strideOf(W, slot, clip, hand) {
  const tau = strideTime(clip), s = tau == null ? null : W.sample(slot, clip.id, tau);
  return s ? { tau, ...footOf(solvePose(s).J, hand === 'L' ? 'R' : 'L') } : null;
}
// Where a batter's back foot digs in, from his stance as the world has him placed: { at, dir }.
// A left-hander's back foot is his left.
export function digOf(W, slot, bats) {
  const s = W.sample(slot, 'bat_stance', 0);
  return s ? footOf(solvePose(s).J, bats === 'L' ? 'L' : 'R') : null;
}

// The clips that put a man down in the dirt, and how low his pelvis is once he's down (ft).
const DOWN_CLIPS = new Set(['slide_feet', 'slide_head', 'slide_hook', 'run_dive_back', 'field_dive_left', 'field_dive_right', 'catch_dive', 'catch_slide']);
const DOWN = 1.3;
// How often his way is sampled while he's down, and how much of it each mark carries (s): a scar
// goes down a stretch at a time as he makes it.
const STEP = 0.04, CHUNK = 0.12;
// How far his leading foot or hands reach on past his pelvis (ft): the scar's last stretch, and
// the heap of dirt ahead of it.
const LEAD = 2.4;
export const SCAR_W = 1.6;

// The scars a plan's bodies leave (diamond/plays.js, bases.js, runs.js): for each clip that puts a
// man down, his pelvis's way over the ground while he's down, a stretch at a time, the last with
// the heap ahead of him. Times on the world's clock. One that's off the dirt isn't sent.
export function scarsOf(bodies, salt = '') {
  const out = [];
  for (const B of bodies || []) {
    B.clips.forEach((e, i) => {
      if (!DOWN_CLIPS.has(e.clip) || e.prior) return;
      const next = B.clips[i + 1], end = Math.min(e.start + CLIPS[e.clip].duration / e.speed, next ? onOf(next) : Infinity);
      const way = [];
      for (let t = onOf(e); t <= end + 1e-9; t += STEP) {
        const s = B.poseAt(t);
        if (!s || !(s.P.pelvis[1] < DOWN)) continue;
        const q = toPark(s.F, s.P.pelvis), last = way[way.length - 1];
        if (!last || Math.hypot(q[0] - last.at[0], q[2] - last.at[1]) > 0.05) way.push({ t, at: [q[0], q[2]] });
      }
      if (!way.length) return;
      const a = way[0].at, b = way[way.length - 1].at, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // the way he was going, and where his leading foot or hands end up
      const dir = l > 0.3 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : (() => { const F = B.frameAt(end); return [Math.sin(F.yaw * DEG), Math.cos(F.yaw * DEG)]; })();
      const tip = [b[0] + dir[0] * LEAD, b[1] + dir[1] * LEAD];
      if (!onDirt(a[0], a[1]) && !onDirt(tip[0], tip[1])) return;
      const seed = hashStr(`scar|${salt}|${B.id}|${i}`);
      let from = 0;
      for (let k = 1; k <= way.length; k++) {
        const lastOne = k === way.length;
        if (!lastOne && way[k].t - way[from].t < CHUNK) continue;
        const pts = way.slice(Math.max(0, from - 1), k).map((w) => w.at);
        if (lastOne) pts.push(tip);
        if (pts.length >= 2) out.push({ t: way[k - 1].t, kind: 'scar', slot: B.slot, pts, w: SCAR_W, end: lastOne, seed: seed + k });
        from = k;
      }
    });
  }
  return out;
}
