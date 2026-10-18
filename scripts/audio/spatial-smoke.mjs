// SPATIAL SMOKE: 3D position and doppler for the GLASS seats.
//
//   node scripts/audio/spatial-smoke.mjs
//
// Pure: reads the graph and schedules on the recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • a cue with no `position` builds no panner and no doppler source
//   • a source passing the listener goes from left to right, and its doppler ratio from
//     above 1 to below 1, through 1 at the closest point
//   • the ratio's cents reach the carrier's and the FM modulator's detune
//   • a listener pose change rotates the panner position: ahead is -z, left is -x
//   • a left-handed frame (the map's, y south) with an explicit `right` still puts right on +x
//   • a listener closing on a still source raises its pitch
//   • HRTF stops at the cap and the rest are equal-power; 'stereo' mode is a stereo pan
//   • `doppler: false` builds no doppler source; closing a voice gives its HRTF slot back
import { loadEngine, tally } from './stub-context.mjs';

const { check, done } = tally('audio:spatial');

const CUE = (id, extra = {}) => ({ id, name: id, category: 'sfx', priority: 2,
  config: { layers: [{ waveform: 'sawtooth', freq: 120, fm: { ratio: 2, index: 1 }, filter: { type: 'lowpass', freq: 900 }, noiseMix: 0.2, adsr: { a: 0.05, d: 0.1, s: 0.8, r: 0.3 } }], ...extra } });
const NORTH = { pos: [0, 0, 0], fwd: [0, 1, 0], up: [0, 0, 1], vel: [0, 0, 0], metresPerUnit: 1 };
const last = (param) => { const l = param.log[param.log.length - 1]; return l ? l.value : param.value; };

// ── No position, no new nodes ───────────────────────────────────────────────
{
  const { A, nodes } = loadEngine();
  const from = nodes.length;
  A.playSfx(CUE('plain'), 1, { pan: 0.5 });
  const made = nodes.slice(from);
  check('an unpositioned cue builds no 3D panner', !made.some(n => n.kind === 'panner3d'));
  check('an unpositioned cue builds no doppler source', !made.some(n => n.kind === 'constant'));
  check('an unpositioned cue keeps its stereo pan', made.some(n => n.kind === 'panner' && n.pan.value === 0.5));
}

// ── A pass from left to right ───────────────────────────────────────────────
{
  const { A, nodes } = loadEngine();
  A.setListenerPose(NORTH);
  const from = nodes.length;
  A.loopSound(CUE('pass'), { position: [-60, 10, 0], velocity: [80, 0, 0], ref: 5 });
  const made = nodes.slice(from);
  const pan = made.find(n => n.kind === 'panner3d');
  const dop = made.find(n => n.kind === 'constant');
  check('a positioned loop builds a 3D panner', !!pan);
  check('a positioned loop builds a doppler source', !!dop);
  const into = new Set((dop?.out || []).map(o => `${o.dst?._owner?.kind}.${o.dst?._name}`));
  check('doppler reaches the carrier detune', [...(dop?.out || [])].some(o => o.dst?._owner?.kind === 'osc' && o.dst?._owner?.type === 'sawtooth' && o.dst?._name === 'detune'), [...into].join(','));
  check('doppler reaches the FM modulator detune', [...(dop?.out || [])].some(o => o.dst?._owner?.kind === 'osc' && o.dst?._owner?.type === 'sine' && o.dst?._name === 'detune'));
  check('doppler reaches the noise and the filter', into.has('buffersrc.detune') && into.has('filter.detune'), [...into].join(','));

  const xs = [], ratios = [];
  for (let x = -60; x <= 60; x += 10) {
    A.moveLoop('pass', [x, 10, 0], [80, 0, 0]);
    const s = A.loopState('pass');
    xs.push(s.rel[0]); ratios.push(s.ratio);
  }
  check('the source starts on the left', xs[0] < 0, xs.join(','));
  check('the source ends on the right', xs[xs.length - 1] > 0, xs.join(','));
  check('left to right without turning back', xs.every((x, i) => i === 0 || x > xs[i - 1]));
  check('the panner was moved to the right', last(pan.positionX) > 0, String(last(pan.positionX)));
  check('ahead of the listener is -z', last(pan.positionZ) < 0, String(last(pan.positionZ)));
  check('approaching, the pitch is up', ratios[0] > 1.05, ratios.map(r => r.toFixed(3)).join(','));
  check('receding, the pitch is down', ratios[ratios.length - 1] < 0.95, ratios.map(r => r.toFixed(3)).join(','));
  check('at the closest point the pitch is unshifted', Math.abs(ratios[6] - 1) < 1e-6, String(ratios[6]));
  check('the ratio only falls through the pass', ratios.every((r, i) => i === 0 || r <= ratios[i - 1] + 1e-9));
  const cents = dop.offset.log.filter(e => e.type === 'target').map(e => e.value);
  check('the cents went from sharp to flat', cents[0] > 0 && cents[cents.length - 1] < 0, cents.slice(0, 2).join(',') + '…' + cents.slice(-1));
  check('the doppler is smoothed, never stepped', dop.offset.log.filter(e => e.type === 'set').length <= 1);

  // ── The listener turns ───────────────────────────────────────────────────
  A.moveLoop('pass', [0, 10, 0], [0, 0, 0]);   // due north of the listener
  A.setListenerPose({ ...NORTH, fwd: [1, 0, 0] });   // facing east: north is on the left
  let s = A.loopState('pass');
  check('facing east, a source due north is on the left', s.rel[0] < -9.9 && Math.abs(s.rel[2]) < 1e-9, s.rel.join(','));
  check('…and the panner moved to -x', last(pan.positionX) < -9.9, String(last(pan.positionX)));
  A.setListenerPose({ ...NORTH, fwd: [-1, 0, 0] });  // facing west: north is on the right
  s = A.loopState('pass');
  check('facing west, it is on the right', s.rel[0] > 9.9, s.rel.join(','));
  A.setListenerPose({ ...NORTH, fwd: [0, -1, 0] });  // facing south: it is behind
  s = A.loopState('pass');
  check('facing south, it is behind (+z)', last(pan.positionZ) > 9.9 && Math.abs(s.rel[0]) < 1e-9, String(last(pan.positionZ)));
  A.setListenerPose({ ...NORTH, up: [0, 0, 1], fwd: [0, 1, 0], pos: [0, 0, -5] });
  s = A.loopState('pass');
  check('a listener below the source hears it above', s.rel[1] > 4.9 && last(pan.positionY) > 4.9, s.rel.join(','));

  // The map's frame: y runs south, so north is -y and the frame is left-handed.
  A.setListenerPose({ pos: [0, 0, 0], fwd: [0, -1, 0], up: [0, 0, 1], right: [1, 0, 0] });
  A.moveLoop('pass', [5, -10, 0], [0, 0, 0]);
  s = A.loopState('pass');
  check('a left-handed frame with `right` given puts east on the right', s.rel[0] > 4.9 && s.rel[2] > 9.9, s.rel.join(','));
  check('…and keeps up as up', s.rel[1] === 0 || Math.abs(s.rel[1]) < 1e-9);

  // A listener flying at a still source.
  A.setListenerPose({ ...NORTH, vel: [0, 100, 0] });
  A.moveLoop('pass', [0, 200, 0], [0, 0, 0]);
  check('a listener closing on a still source hears it sharp', A.loopState('pass').ratio > 1.2, String(A.loopState('pass').ratio));
  A.setListenerPose({ ...NORTH, vel: [0, -100, 0] });
  check('…and flat flying away', A.loopState('pass').ratio < 0.8);
  check('the ratio is clamped', A.loopState('pass').ratio >= 0.5);
  A.stopLoop('pass');
}

// ── A one-shot's handle ─────────────────────────────────────────────────────
{
  const { A } = loadEngine();
  A.setListenerPose(NORTH);
  const h = A.playSfx(CUE('shot'), 1, { position: [10, 0, 0] });
  check('a positioned one-shot returns a handle', typeof h?.move === 'function');
  check('it starts on the right', h.state().rel[0] > 9.9);
  h.move([-10, 0, 0]);
  check('moved, it is on the left', h.state().rel[0] < -9.9);
  check('an unpositioned one-shot still returns null', A.playSfx(CUE('plain2'), 1, {}) === null);
}

// ── The HRTF cap, the modes, doppler off ────────────────────────────────────
{
  const { A, nodes, timers } = loadEngine();
  A.setListenerPose(NORTH);
  const from = nodes.length;
  for (let i = 0; i < 8; i++) A.loopSound(CUE('cap' + i), { position: [i, 5, 0] });
  const pans = nodes.slice(from).filter(n => n.kind === 'panner3d');
  const cap = A._spatialStats().cap;
  check('eight loops, eight panners', pans.length === 8, String(pans.length));
  check('HRTF stops at the cap', pans.filter(p => p.panningModel === 'HRTF').length === cap, `${pans.filter(p => p.panningModel === 'HRTF').length} vs ${cap}`);
  check('the rest are equal-power', pans.filter(p => p.panningModel === 'equalpower').length === 8 - cap);
  for (let i = 0; i < 8; i++) A.stopLoop('cap' + i);
  for (const t of timers.splice(0)) if (t.ms >= 1000) t.fn();
  check('closed voices give their HRTF slots back', A._spatialStats().hrtf === 0 && A._spatialStats().live === 0, JSON.stringify(A._spatialStats().hrtf));

  const f2 = nodes.length;
  A.playSfx(CUE('nodop'), 1, { position: [3, 3, 0], doppler: false });
  check('doppler: false builds no doppler source', !nodes.slice(f2).some(n => n.kind === 'constant'));
  const f3 = nodes.length;
  A.playSfx(CUE('cuedop', { doppler: false }), 1, { position: [3, 3, 0] });
  check("a cue's own doppler: false is honoured", !nodes.slice(f3).some(n => n.kind === 'constant'));
}
{
  const { A, nodes } = loadEngine({ settings: { spatialAudio: 'equalpower' } });
  A.setListenerPose(NORTH);
  const from = nodes.length;
  A.playSfx(CUE('ep'), 1, { position: [4, 4, 0] });
  check("'equalpower' never uses HRTF", nodes.slice(from).filter(n => n.kind === 'panner3d').every(p => p.panningModel === 'equalpower'));
}
{
  const { A, nodes } = loadEngine({ settings: { spatialAudio: 'stereo' } });
  A.setListenerPose(NORTH);
  const from = nodes.length;
  A.playSfx(CUE('st'), 1, { position: [10, 1, 0] });
  const made = nodes.slice(from);
  check("'stereo' builds no 3D panner", !made.some(n => n.kind === 'panner3d'));
  check("'stereo' pans the source right", made.some(n => n.kind === 'panner' && n.pan.log[0]?.value > 0.5));
  check("'stereo' has no doppler", !made.some(n => n.kind === 'constant'));
}

done();
