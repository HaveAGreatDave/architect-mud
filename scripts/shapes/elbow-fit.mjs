// DEADBALL · THE ELBOWS KEYED TO THE GRIP. A clip places a hand on the bat by the bat and its wrist alone, and its elbow
// by the pole it keys; a pole that fights the grip leaves the forearm turned on its hand further than a forearm turns
// (the figure's wrist wrung past 120°, figure-rig.mjs WRIST_KNOWN). This turns each key's elbow pole, for a hand
// on the bat, the least that brings that forearm's roll inside FREE (60°), both hands held thumb to the barrel
// (figure-rig.js figureRowsHeld) so no hand turns over on the bat mid-clip. A pole may not take a key past a joint
// limit it kept, put the elbow nearer his middle than it was, or turn a direction further from its neighbours' than
// the schema lets one (140°, under MAX_TURN), and the change from the key before costs more the closer the keys are.
// Then anim-smoke's elbow checks run on the clip (speed, change of speed, the jump at a key, every frame a pose a body
// makes), and the keys round anything that fails take back half their change, up to eight times.
//
//   node scripts/shapes/elbow-fit.mjs bat_swing_mid bat_stance ...      a dry run: what each key would go to
//   WRITE=1 node scripts/shapes/elbow-fit.mjs <clips>                  write the clips, then npm run clips:bake
//
// Run 2026-11-15 over the 26 clips that hold a bat or a rod.
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url);
const R = new URL('client/game/js/panels/', ROOT).href;
const FR = await import(R + 'diamond/figure-rig.js');
const { completePose, limitBreaks, sampleClip, DIRS } = await import(R + 'diamond/anim.js');
const { solvePose, boneFrames, BONES, FRAME_FLOATS } = await import(R + 'diamond/rig.js');
const { formatClip } = await import(R + 'diamond/clip-schema.js');
const frames = new Float32Array(BONES.length * FRAME_FLOATS), rows = new Float32Array(FR.FIG_ROW_FLOATS);
const D = 180 / Math.PI, sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(...a), norm = (a) => a.map((v) => v / (len(a) || 1));
const clear = (J, e) => { const a = J.chest, ab = sub(J.pelvis, a), u = Math.max(0, Math.min(1, dot(sub(e, a), ab) / dot(ab, ab))); return len(sub(e, a.map((v, i) => v + ab[i] * u))); };
const solve = (pose) => solvePose({ ...pose, at: [0, 0, 0], yaw: 0, scale: 1 });
const twOf = (pose, g) => { const sol = solve(pose); boneFrames(sol, frames); FR.figureRowsHeld(sol, frames, rows, g); return { tw: FR.forearmTwist(rows), sol }; };
const FREE = 60;   // degrees of roll either way that cost nothing
const dirs = [];
for (let el = -75; el <= 75; el += 15) for (let az = 0; az < 360; az += 12) { const e = el / D, a = az / D; dirs.push([Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]); }
const ids = process.argv.slice(2);
for (const id of ids) {
  const file = new URL('content/animation_clips/' + id + '.json', ROOT), raw = fs.readFileSync(file, 'utf8'), doc = JSON.parse(raw);
  const P0 = doc.keys.map((k) => completePose(k.pose));
  const orig0 = { id: doc.id, role: doc.role, duration: doc.duration, loop: !!doc.loop, events: doc.events || [], plants: (doc.plants || []).slice().sort((a, b) => a.from - b.from), ...(doc.root ? { root: doc.root } : {}), keys: doc.keys.map((k) => ({ t: k.t, ...(k.tension ? { tension: k.tension } : {}), pose: completePose(k.pose) })) };
  const grips = P0.map((P) => solve(P).J);
  // both hands thumb to the barrel for the whole clip, every batting clip alike, so none turns over at a hand-off
  const g = { L: false, R: false };
  const report = [], prev = { L: null, R: null };
  doc.keys.forEach((k, i) => {
    const base = P0[i], J = grips[i];
    for (const S of ['L', 'R']) {
      if (!J['grip' + S]) continue;
      const orig = norm(base['elb' + S]), before = twOf(base, g), breaks0 = limitBreaks(base, before.sol).length, room = Math.min(0.42, clear(before.sol.J, before.sol.J['el' + S]));
      const t0 = Math.abs(before.tw[S]) * D;
      if (t0 <= FREE && !prev[S]) continue;
      // the correction (new pole less authored) moves smoothly from the key before: the closer the keys, the more
      // a change in it costs, or the elbow whips between them
      const corr = (d) => d.map((v, j) => v - orig[j]), dt = prev[S] ? Math.max(0.02, k.t - prev[S].t) : 1;
      const jerk = (d) => (prev[S] ? len(corr(d).map((v, j) => v - prev[S].c[j])) * D * (0.08 / dt) : 0);
      let best = { score: Math.max(0, t0 - FREE) + jerk(orig), d: orig, tw: t0 };
      for (const d of dirs) {
        const P = completePose({ ...k.pose, ['elb' + S]: d }), r = twOf(P, g), tw = Math.abs(r.tw[S]) * D;
        if (clear(r.sol.J, r.sol.J['el' + S]) < room - 1e-6) continue;
        if (limitBreaks(P, r.sol).length > breaks0) continue;
        // no direction turning further than the schema lets one between keys (clip-schema.js MAX_TURN), either side
        const near = [doc.keys[i - 1], doc.keys[i + 1]].filter(Boolean).map((q) => completePose(q.pose));
        if (near.some((Q) => DIRS.some((f) => Q[f] && P[f] && Math.acos(Math.max(-1, Math.min(1, dot(norm(Q[f]), norm(P[f]))))) * D > 140))) continue;
        const score = Math.max(0, tw - FREE) + 0.15 * Math.acos(Math.max(-1, Math.min(1, dot(orig, d)))) * D + jerk(d);
        if (score < best.score) best = { score, d, tw };
      }
      report.push(`${k.t}${S} ${t0.toFixed(0)}→${best.tw.toFixed(0)}°`);
      if (best.d !== orig) k.pose['elb' + S] = best.d.map((v) => +v.toFixed(3));
      prev[S] = { t: k.t, c: corr(best.d) };
    }
  });
  // a loop's last key is its first again (clip-schema.js), elbows and all
  const loopUp = () => { if (!doc.loop) return; const a = doc.keys[0].pose, z = doc.keys[doc.keys.length - 1].pose; for (const S of ['L', 'R']) { if ('elb' + S in a) z['elb' + S] = a['elb' + S]; else delete z['elb' + S]; } };
  loopUp();
  // anim-smoke's elbow checks on the clip as fitted (120 frames a second: 140 ft/s, 10,000 ft/s², and no jump in speed
  // across a key over 1 ft/s, plus every frame a pose a body makes at 500 a second); where one fails, the keys round
  // it take back half their correction, until none does
  const bake = () => ({ id: doc.id, role: doc.role, duration: doc.duration, loop: !!doc.loop, ...(doc.moving ? { moving: doc.moving } : {}), events: doc.events || [], plants: (doc.plants || []).slice().sort((a, b) => a.from - b.from), ...(doc.root ? { root: doc.root } : {}), keys: doc.keys.map((k) => ({ t: k.t, ...(k.tension ? { tension: k.tension } : {}), pose: completePose(k.pose) })) });
  const ELS = ['elL', 'elR'];
  const faults = () => {
    const c = bake(), Dur = c.duration, N = Math.max(1, Math.ceil(Dur * 120)), dt = Dur / N, out = [];
    let prev = null, pv = null;
    for (let i = 0; i <= N; i++) {
      const t = i * dt, J = solve(sampleClip(c, t)).J, cur = ELS.map((k) => J[k]);
      if (prev) {
        const v = cur.map((q, j) => sub(q, prev[j]).map((x) => x / dt));
        v.forEach((w, j) => { if (len(w) > 135 || (pv && len(sub(w, pv[j])) / dt > 9500)) out.push(t); });
        pv = v;
      }
      prev = cur;
    }
    for (let t = 0; t <= Dur + 1e-9; t += 1 / 500) { const P = sampleClip(c, t); if (limitBreaks(P, solve(P)).length && !limitBreaks(P, solve(sampleClip(orig0, t))).length) out.push(t); }
    const at = (t) => solve(sampleClip(c, t)).J;
    for (const k of c.keys) {
      if (k.t < 1e-3 || k.t > Dur - 1e-3) continue;
      const jump = (h) => { const [a, b, d] = [k.t - h, k.t, k.t + h].map(at); return ELS.map((e) => sub(sub(d[e], b[e]), sub(b[e], a[e])).map((x) => x / h)); };
      const big = jump(5e-4), half = jump(2.5e-4);
      if (big.some((g2, j) => len(sub(half[j].map((x) => 2 * x), g2)) > 0.95)) out.push(k.t);
    }
    return out;
  };
  const authored = JSON.parse(raw).keys;
  for (let round = 0; round < 8; round++) {
    const bad = faults();
    if (!bad.length) break;
    const near = new Set();
    for (const t of bad) { let i = doc.keys.findIndex((k) => k.t >= t - 1e-9); if (i < 0) i = doc.keys.length - 1; for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < doc.keys.length) near.add(j); }
    for (const j of near) for (const S of ['L', 'R']) {
      const a = completePose(authored[j].pose)['elb' + S], b = doc.keys[j].pose['elb' + S];
      if (!b || !a) continue;
      const m = norm(a.map((v, q) => v * 0.5 + norm(b)[q] * 0.5));
      doc.keys[j].pose['elb' + S] = round === 7 ? authored[j].pose['elb' + S] ?? a : m.map((v) => +v.toFixed(3));
    }
    loopUp();
    report.push('eased:' + [...near].join(','));
  }
  console.log(id, 'grip', JSON.stringify(g), report.join(' '));
  if (process.env.WRITE) { const out = formatClip(doc); fs.writeFileSync(file, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out); }
}
