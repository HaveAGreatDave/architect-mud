// THE GATE FOR EVERY SEAT'S CONTROLS AND LETTERING, across all the cockpits at once.
//
// Three questions, each silent when wrong:
//   a) does every control in a flight seat do something? cockpit.js takes a click on a hotspot to
//      DK_ACT by its id and a drag or a hold by its kind, and names it from DK_TIP. A hotspot whose id
//      DK_ACT lacks still gets the hand cursor and the halo, and the click does nothing: the Mule's
//      BAT switch sent 'ck:battery', and six cockpits had BCN, NAV and STRB switches for circuits the
//      sim doesn't have.
//   b) does every word in every seat read true from the eye? The kit reports each label drawn on a
//      panel it had to turn round to face the eye (KIT_TRACE), and that label reads mirrored. Every
//      overhead label in the Mule did (docs/reference/cockpit-lettering.md rule 7).
//   c) is every word big enough to read from the eye? legend-font.js reports each line it draws
//      (LEGEND_TRACE) with its baseline and cap line in cabin metres, and the angle between them from
//      the eye is how tall it looks. Under LEGIBLE_ARCMIN it's a smudge in the seat view. Most seats
//      had dozens of those when this was written, so it's a ratchet: cockpit-legibility.json holds
//      each seat's count, a count that rises fails, and `--update` locks in a count that fell.
// Each cockpit's own gate (cockpit-<id>.mjs) asks whether its room is right; this one asks it of all.
// Run: node scripts/shapes/cockpit-controls.mjs   (exit 1 on any failure; --update rewrites the ratchet)
import { readFileSync, writeFileSync } from 'node:fs';
import { shellFaces, shellProfileFor, SHELL_CLASS } from '../../client/shared/interior-shell.js';
import { drakeHotspots } from '../../client/shared/interior-drake.js';
import { KIT_TRACE } from '../../client/shared/interior-kit.js';
import { LEGEND_TRACE } from '../../client/shared/legend-font.js';
import { BOAT_ROWS } from '../../client/shared/vehicle-models.js';
import { readDkTables } from './dk-tables.mjs';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// Every seat a class can sit in, by a name for the messages.
const SEATS = [];
for (const cls of Object.keys(SHELL_CLASS)) SEATS.push([cls, cls, false, null]);
SEATS.push(['heli (armed)', 'heli', true, null]);
for (const trim of ['noir', 'quackhawk']) SEATS.push(['drake (' + trim + ')', 'drake', false, trim]);
for (const cls of Object.keys(BOAT_ROWS)) if (!SHELL_CLASS[cls]) SEATS.push([cls, cls, false, null]);

// The seats whose clicks go somewhere other than cockpit.js, and so are only asked (b).
const NOT_FLIGHT = {
  truck: 'cab-view.js takes its clicks (truckHotspots, the fascia banks)',
  hydro: 'boat-view.js takes its clicks',
  podracer: 'podracer-view.js takes its clicks (the levers drag, START, BRAKE and BOOST)',
  bridge: 'the wheelhouse has no hotspots; helm-view.js is its panel',
};
const isBoat = (cls) => cls === 'hydro' || (!!BOAT_ROWS[cls] && !SHELL_CLASS[cls]);
// A boat seat's clicks go to boat-view.js, which takes a 'click' to pressControl and a 'hold' to
// HOLD_KEY, and nothing else. The controls each boat seat must draw, by id: the Keel's eight
// (docs/proposals/boat-fishing.md section 1) and her starter cord, which is the seat's key.
const BOAT_KINDS = new Set(['click', 'hold']);
const BOAT_CONTROLS = {
  skiff: ['fast', 'slow', 'kill', 'choke', 'prime', 'cleat', 'lamp', 'box', 'rod', 'ign'],
};
const flight = (cls) => !NOT_FLIGHT[cls] && !isBoat(cls);

// Live states between them: power off and on, day and night, gear and flaps at both ends, armed. A
// control that only appears in some of them is still a control.
const STATES = [
  { powered: true, engineOn: true, throttle: 0.5, rpm: 0.8, ias: 110, alt: 4500, hdg: 90, fuel: 0.6, hull: 1, hour: 12, gearDown: true },
  { powered: true, engineOn: true, throttle: 1, rpm: 1, ias: 160, alt: 9000, hdg: 200, fuel: 0.2, hull: 0.5, hour: 23,
    panelLight: true, landingLight: true, dome: true, flapNotch: 3, gearDown: false, weaponsArmed: true, stickX: 1, stickY: -1 },
  { powered: false, throttle: 0, rpm: 0, hour: 2, gearDown: true },
];

// How tall a line of legend has to look from the eye to read: 20 arcminutes is about six pixels in
// the seat view, one pixel per row of the face's 4 x 6 grid. The Drake's smallest label is about 29.
const LEGIBLE_ARCMIN = 20;
const arcmin = (a, b) => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.max(-1, Math.min(1, c))) * 10800 / Math.PI;
};
const BASELINE_URL = new URL('./cockpit-legibility.json', import.meta.url);
const UPDATE = process.argv.includes('--update');
let BASELINE = {};
try { BASELINE = JSON.parse(readFileSync(BASELINE_URL, 'utf8')); } catch { BASELINE = {}; }
const small = {};
let improved = 0;

const { ACT, TIP, KINDS } = readDkTables();
ok(!!ACT && !!TIP && !!KINDS, 'could not read DK_ACT, DK_TIP or the hotspot kinds out of cockpit.js; every check below would pass on nothing');

let seats = 0, controls = 0;
for (const [name, cls, armed, trim] of SEATS) {
  const P = shellProfileFor(cls, armed, trim);
  if (!P) continue;
  seats++;
  const mirrored = new Map();
  KIT_TRACE.mirrored = (str, o) => mirrored.set(str, o);
  // One entry per line of lettering (its words and where it is), at its smallest across the states.
  const sizes = new Map();
  LEGEND_TRACE.label = (str, foot, head) => {
    const key = str + '@' + foot.map((x) => x.toFixed(2)).join(',');
    const m = arcmin(foot, head);
    if (!sizes.has(key) || sizes.get(key).m > m) sizes.set(key, { str, m });
  };
  const hs = new Map();
  for (const live of STATES) {
    // Built first: the Drake records where its levers and stores landed while it draws them.
    shellFaces(P, live);
    const list = cls === 'drake' ? drakeHotspots(live) : (typeof P.hotspots === 'function' ? P.hotspots(live) : []);
    for (const h of list || []) hs.set(h.id, h.kind);
  }
  KIT_TRACE.mirrored = null;
  LEGEND_TRACE.label = null;

  // a) every control does something, and says what.
  if (flight(cls) && ACT && TIP && KINDS) {
    for (const [id, kind] of hs) {
      controls++;
      ok(KINDS.has(kind), name + ': ' + id + ' is a "' + kind + '" hotspot, a kind cockpit.js does nothing with');
      if (kind === 'click') ok(ACT.has(id), name + ': ' + id + ' has no action in cockpit.js DK_ACT, so the click does nothing');
      ok(TIP.has(id), name + ': ' + id + ' has no tooltip in cockpit.js DK_TIP');
    }
  }
  // a') a boat seat's controls are the ones it must have, each of a kind boat-view.js acts on.
  if (isBoat(cls)) {
    for (const [id, kind] of hs) ok(BOAT_KINDS.has(kind), name + ': ' + id + ' is a "' + kind + '" hotspot, a kind boat-view.js does nothing with');
    for (const id of BOAT_CONTROLS[cls] || []) ok(hs.has(id), name + ': has no ' + id + ' control (BOAT_CONTROLS)');
  }
  // b) every word reads true from the seat.
  ok(!mirrored.size, name + ': ' + [...mirrored].map(([s, o]) => '"' + s + '" at [' + o.map((x) => x.toFixed(2)).join(', ') + ']').join(', ')
    + ' read mirrored. Its panel faces away from the eye; give it the across and up you read it by (cockpit-lettering.md rule 7)');
  // c) every word is big enough to read from the seat, or at least no more of them are too small.
  const tiny = [...sizes.values()].filter((x) => x.m < LEGIBLE_ARCMIN).sort((a, b) => a.m - b.m);
  small[name] = tiny.length;
  const was = BASELINE[name] ?? 0;
  if (tiny.length < was) improved++;
  if (!UPDATE) ok(tiny.length <= was, name + ': ' + tiny.length + ' labels under ' + LEGIBLE_ARCMIN + ' arcmin from the eye (the ratchet allows ' + was
    + '), smallest ' + tiny.slice(0, 5).map((x) => '"' + x.str + '" ' + x.m.toFixed(1) + "'").join(', ') + '. Make them bigger (cockpit-lettering.md rule 4)');
}
ok(seats >= 15, 'only ' + seats + ' seats found; shellProfileFor or SHELL_CLASS has changed shape');

console.log('    ' + seats + ' seats · ' + controls + ' flight controls · '
  + Object.values(small).reduce((a, b) => a + b, 0) + ' labels too small to read from the seat');
if (UPDATE) {
  writeFileSync(BASELINE_URL, JSON.stringify(Object.fromEntries(Object.entries(small).filter(([, n]) => n > 0)), null, 2) + '\n');
  console.log('    cockpit-legibility.json rewritten');
} else if (improved) console.log('    ' + improved + ' seats have fewer small labels than the ratchet allows: run with --update to lock them in');
console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
