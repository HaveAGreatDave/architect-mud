// cockpit-barrow-2076: the gate for the Barrow 2076's cab (client/shared/interior-barrow-2076.js).
//
//   node scripts/shapes/cockpit-barrow-2076.mjs      (in the shapes group; no browser, no database)
//
// shell.mjs walks every profile for the room's own laws (the eye, the sight lines, the bounds); this
// holds what's particular to this cab, each of which fails silently if it is wrong:
//   1. It is reached only by the Barrow's 2076 edition, in any state of the variant string.
//   2. A hotspot is a CAB_CTL key. cab-view's pressCtl drops an id it doesn't know without a word, and
//      cockpit-controls.mjs doesn't look, because a truck's clicks aren't DK_ACT's.
//   3. Every switch the truck has is a key in the forward view; a disabled one has no hotspot, and a
//      Barrow's short list of switches gets a short row of keys.
//   4. Each readout moves on its own sim value, and the hologram bends with the trailer.
//   5. The glass boots on the key: dark with it off, pages arriving in turn, and all up once settled.
//   6. An alert reaches the light lines; the hand lights a key; a bought trinket still draws.
//   7. The flicker is decoration: across wall time with nothing else changing, only the route page
//      changes, and only in brightness; every number on it still moves with its value while it's dim.
//      The dead page lights nothing.
//   8. Lettering: 20 arcminutes, never mirrored, only the legend face's characters.
import { readFileSync } from 'node:fs';

// ⚠ THE CLOCK IS HELD STILL. The hologram's pads breathe, an alert line pulses and the route page
// flickers on wall time, so on a running clock any two frames differ and every "this moved" below
// would pass for nothing.
let NOW = 1000;
Object.defineProperty(performance, 'now', { value: () => NOW, configurable: true });

const { SHELL_PROFILES, shellProfileFor, shellFaces } = await import('../../client/shared/interior-shell.js');
const { bw76Flicker, bw76PageAt, BW76_PAGES } = await import('../../client/shared/interior-barrow-2076.js');
const P = SHELL_PROFILES.barrow2076, STOCK = SHELL_PROFILES.truck;
const problems = [];
const say = (ok, msg) => { if (!ok) problems.push(msg); };

// 1: routing
for (const v of ['scrapper~e2076', 'scrapper+t~e2076', 'scrapper+t~e2076~p^rp', 'scrapper~e2076~p']) say(shellProfileFor('truck', false, v) === P, v + ' does not get the 2076 cab');
for (const v of ['scrapper', 'scrapper+t~p', 'scrapper~e2099', 'hauler']) say(shellProfileFor('truck', false, v) === STOCK, v + ' should get the stock cab');
for (const v of ['hauler~e2076', 'drayman+t~e2076', 'continental~e2076~p']) say(shellProfileFor('truck', false, v) !== P, v + ' should not get the Barrow\'s cab');

const cv = readFileSync(new URL('../../client/game/js/panels/cab-view.js', import.meta.url), 'utf8');
const table = cv.slice(cv.indexOf('const CAB_CTL = ['), cv.indexOf('];', cv.indexOf('const CAB_CTL = [')));
const KEYS = new Set([...table.matchAll(/\{ key: '([a-z]+)'/g)].map((m) => m[1]));
say(KEYS.size >= 13, 'could not read CAB_CTL out of cab-view.js (' + KEYS.size + ' keys)');

const cell = (key, on = false, enabled = true) => ({ key, on, enabled });
const LEFT = ['key', 'jake', 'heads', 'dome', 'horn', 'cruise'], RIGHT = ['auto', 'trailer', 'park', 'pump', 'latch', 'galley', 'exit'];
const base = () => ({
  tier: 0, mph: 46, rpm: 0.6, gear: '5', fuel: 0.66, steer: 0, pedals: { clutch: 0, brake: 0, throttle: 0.5 },
  engineOn: true, trailerPhi: 8, brakeTemp: 0.2, fading: false, powered: true, powerAge: 9, hdg: 128, hour: 13.4,
  legFrac: 0.35, legLeft: 42, aim: 'the-reach', glow: [255, 174, 66], lamps: {}, toys: {},
  ctl: { left: LEFT.map((k) => cell(k)), right: RIGHT.map((k) => cell(k)) },
});
const live = (o = {}) => ({ ...base(), ...o });
const faces = (L) => shellFaces(P, L, { rich: true });
const sig = (fs) => { let s = 0; for (const f of fs) for (const p of f.p) s = (s * 31 + Math.round((p[0] + p[1] * 3 + p[2] * 7) * 1e4) + (f.emis ? Math.round(f.emis * 100) : 0)) | 0; return s + ':' + fs.length; };
const cen = (f) => { const c = [0, 0, 0]; for (const p of f.p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((x) => x / f.p.length); };
const fkey = (f) => f.p.map((p) => p.map((x) => Math.round(x * 1e5)).join(',')).join(';') + '|' + (f.rgb || []).map((x) => Math.round(x)).join(',') + '|' + Math.round((f.emis || 0) * 1000);
// Faces in `a` and not in `b`, and the other way, as one list.
const diff = (a, b) => {
  const cnt = new Map();
  for (const f of a) cnt.set(fkey(f), (cnt.get(fkey(f)) || 0) + 1);
  const out = [];
  for (const f of b) { const k = fkey(f), n = cnt.get(k) || 0; if (n) cnt.set(k, n - 1); else out.push(f); }
  for (const f of a) { const k = fkey(f), n = cnt.get(k) || 0; if (n) { cnt.set(k, n - 1); out.push(f); } }
  return out;
};

// The room's own health, for this state.
{
  const fs = faces(live());
  say(fs.length > 2000 && fs.length < 16000, 'face budget: ' + fs.length);
  let bad = 0;
  for (const f of fs) {
    const l = Math.hypot(...f.n);
    if (!(Math.abs(l - 1) < 1e-3) || f.p.some((v) => v.some((c) => !Number.isFinite(c)))) bad++;
  }
  say(!bad, bad + ' faces with a bad normal or a non-finite vertex');
}

// 2 + 3: the keys
{
  const hs = P.hotspots(live());
  say(hs.length === LEFT.length + RIGHT.length, 'expected a hotspot per switch, got ' + hs.length);
  for (const h of hs) {
    say(KEYS.has(h.id), 'hotspot ' + h.id + ' is not a CAB_CTL key');
    say(h.kind === 'click', 'hotspot ' + h.id + ' is not a click');
    // The forward view: well inside what the seat shows, ahead and below the screen's foot line.
    const yaw = Math.atan2(h.p[0], h.p[1]) * 180 / Math.PI, pitch = Math.atan2(h.p[2], Math.hypot(h.p[0], h.p[1])) * 180 / Math.PI;
    say(Math.abs(yaw) < 46 && pitch > -36 && pitch < -8, 'hotspot ' + h.id + ' is out of the forward view (yaw ' + yaw.toFixed(1) + ', pitch ' + pitch.toFixed(1) + ')');
  }
  const off = live({ ctl: { left: [cell('key', false, false)], right: [cell('park')] } });
  say(P.hotspots(off).map((h) => h.id).join() === 'park', 'a disabled switch still has a hotspot');
  say(P.hotspots({}).length === 0, 'no ctl should mean no hotspots');
  // A Barrow with only its own few switches: a key for each and nothing else.
  const few = live({ ctl: { left: ['key', 'heads', 'horn'].map((k) => cell(k)), right: ['park', 'trailer', 'exit'].map((k) => cell(k)) } });
  say(P.hotspots(few).map((h) => h.id).sort().join() === 'exit,heads,horn,key,park,trailer', 'a short switch list should give exactly its own keys');
  say(faces(few).length < faces(live()).length, 'fewer switches should draw fewer keys');
}

// 4: readouts. First that two frames of one state are the same frame, or none of this means anything.
say(sig(faces(live())) === sig(faces(live())), 'two frames of one state differ, so the checks below can\'t fail');
const STOPS = {
  mph: [12, 88], rpm: [0.2, 0.9], fuel: [0.1, 0.9], gear: ['2', '7'], trailerPhi: [-30, 30], brakeTemp: [0.1, 0.7],
  hdg: [10, 200], legLeft: [3, 90], legFrac: [0.1, 0.9], hour: [8.25, 21.75],
};
for (const [k, [a, b]] of Object.entries(STOPS)) say(sig(faces(live({ [k]: a }))) !== sig(faces(live({ [k]: b }))), k + ' moves nothing in the cab');
{
  const rig = (phi) => sig(faces(live({ trailerPhi: phi })).filter((f) => f.p[0][1] > 0.7 && f.p[0][2] > -0.24));
  say(rig(-25) !== rig(25), 'the hologram does not bend with the trailer');
  const box = faces(live({ trailerPhi: null })), hitched = faces(live());
  say(box.length < hitched.length, 'a bobtail draws no less than a hitched rig');
  say(sig(faces(live({ pedals: { clutch: 0, brake: 0, throttle: 0 } }))) !== sig(faces(live({ pedals: { clutch: 1, brake: 0, throttle: 0 } }))), 'the clutch is not mirrored');
  say(sig(faces(live({ lamps: { jake: false } }))) !== sig(faces(live({ lamps: { jake: true } }))), 'the Jake is not mirrored');
}

// 5: the boot. A key's flash eases over 240 ms, so settle before counting.
{
  const dark = faces(live({ powered: false }));
  const booting = faces(live({ powerAge: 0.2 }));
  NOW += 300;
  const up = faces(live({ powerAge: 5 }));
  say(dark.length < booting.length, 'the glass is not dark with the key off');
  say(booting.length < up.length, 'the pages do not arrive in turn');
}

// 6: alert, hand, trinket
{
  const lineCol = (L) => faces(L).filter((f) => f.emis > 0.4 && f.rgb).map((f) => f.rgb.join()).join('|');
  say(lineCol(live()) !== lineCol(live({ fading: true, lamps: { brake: true } })), 'a brake fade does not reach the light lines');
  say(lineCol(live()) !== lineCol(live({ fuel: 0.1 })), 'low fuel does not reach the light lines');
  say(faces(live({ hover: 'park' })).length > faces(live()).length, 'the hand does not light a key');
  const toy = { kind: 'bobble', id: 'test', pal: { body: '#aa3322', pip: '#eeeeee', cord: '#ccbbaa', edge: '#551111' }, mass: 1, len: 0.05, sway: 0.08 };
  say(faces(live({ toys: { dash: toy } })).length > faces(live()).length, 'a dash trinket draws nothing on the shelf');
}

// 7: the flicker and the dead page. With the revs at nothing the hologram's pads hold still, so the
// only thing left on wall time is the route page's backlight.
{
  const t0 = NOW / 1000;
  let tSteady = null, tDim = null;
  for (let i = 0; i < 4000 && (tSteady == null || tDim == null); i++) {
    const t = t0 + i * 0.013, k = bw76Flicker(t);
    if (k === 1 && tSteady == null) tSteady = t;
    if (k < 0.5 && tDim == null) tDim = t;
  }
  say(tSteady != null && tDim != null, 'the flicker never dips, or never steadies, over a minute of wall time');
  if (tSteady != null && tDim != null) {
    const still = live({ rpm: 0 });
    const at = (t, L = still) => { NOW = t * 1000; faces(L); NOW = t * 1000; return faces(L); };   // twice, so anything eased has settled
    const a = at(tSteady), b = at(tDim);
    const changed = diff(a, b);
    say(changed.length > 0, 'the route page does not flicker');
    const route = bw76PageAt(P, 'route'), half = BW76_PAGES.find((p) => p.id === 'route').w + 0.03;
    const far = changed.filter((f) => Math.hypot(...cen(f).map((c, i) => c - route[i])) > half);
    say(!far.length, far.length + ' faces away from the route page change with wall time (first at ' + (far[0] ? cen(far[0]).map((x) => x.toFixed(3)).join(', ') : '') + ')');
    // The same faces, dimmer: the flicker moves no vertex.
    const shape = (fs) => fs.map((f) => f.p.map((p) => p.map((x) => Math.round(x * 1e5)).join(',')).join(';')).sort().join('|');
    say(shape(a) === shape(b), 'the flicker moves geometry, not just brightness');
    // Dimmed, the route page still reads its values.
    for (const k of ['hdg', 'legLeft', 'legFrac']) {
      const [x, y] = STOPS[k];
      say(sig(at(tDim, live({ rpm: 0, [k]: x }))) !== sig(at(tDim, live({ rpm: 0, [k]: y }))), k + ' stops moving the route page while it flickers');
    }
    // The dead page lights nothing, powered or not.
    const dead = bw76PageAt(P, 'dead');
    const lit = at(tSteady).filter((f) => (f.emis || 0) > 0.3 && Math.hypot(...cen(f).map((c, i) => c - dead[i])) < 0.06);
    say(!lit.length, lit.length + ' lit faces on the dead page');
    NOW = 2000;
  }
}

// 8: lettering, with the switches in. cockpit-controls.mjs measures this seat too, but its states have
// no `ctl`, so it never sees a key's label. The same 20 arcminutes, the same mirror test, and the
// characters the legend face has.
{
  const { KIT_TRACE } = await import('../../client/shared/interior-kit.js');
  const { LEGEND_TRACE } = await import('../../client/shared/legend-font.js');
  const arcmin = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 10800 / Math.PI;
  const seen = new Map(), mirrored = [];
  KIT_TRACE.mirrored = (str) => mirrored.push(str);
  LEGEND_TRACE.label = (str, foot, head) => { const m = arcmin(foot, head); if (!seen.has(str) || seen.get(str) > m) seen.set(str, m); };
  for (const o of [{}, { trailerPhi: null }, { aim: null, legLeft: null }, { elecOut: true }, { fading: true, lamps: { brake: true, dmg: true, jake: true } }]) faces(live(o));
  KIT_TRACE.mirrored = null; LEGEND_TRACE.label = null;
  say(seen.size > 30, 'the lettering trace saw only ' + seen.size + ' labels, so this check is not looking');
  for (const k of ['KEY', 'CRUISE', 'GALLEY', 'DOORS', 'KM/H', 'HDG', 'BRAKE', 'KRELL', 'BARROW 2076', '4471']) say(seen.has(k), 'no label ' + k + ' drawn');
  say(!mirrored.length, 'mirrored lettering: ' + mirrored.join(', '));
  for (const [str, m] of seen) {
    say(m >= 20, JSON.stringify(str) + ' is ' + m.toFixed(1) + ' arcmin, under 20');
    say(/^[A-Z0-9 /-]*$/.test(str), JSON.stringify(str) + ' has a character the legend face lacks');
  }
}

if (problems.length) {
  console.error('cockpit-barrow-2076: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('cockpit-barrow-2076: ' + faces(live()).length + ' faces, ' + P.hotspots(live()).length + ' keys, all reading and all reachable; the flicker is the route page\'s brightness alone.');
