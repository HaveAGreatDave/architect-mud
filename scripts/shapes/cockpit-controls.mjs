// THE GATE FOR EVERY SEAT'S CONTROLS AND LETTERING, across all the cockpits at once.
//
// Two questions, each silent when wrong:
//   a) does every control in a flight seat do something? cockpit.js takes a click on a hotspot to
//      DK_ACT by its id and a drag or a hold by its kind, and names it from DK_TIP. A hotspot whose id
//      DK_ACT lacks still gets the hand cursor and the halo, and the click does nothing: the Mule's
//      BAT switch sent 'ck:battery', and six cockpits had BCN, NAV and STRB switches for circuits the
//      sim doesn't have.
//   b) does every word in every seat read true from the eye? The kit reports each label drawn on a
//      panel it had to turn round to face the eye (KIT_TRACE), and that label reads mirrored. Every
//      overhead label in the Mule did (docs/reference/cockpit-lettering.md rule 7).
// Each cockpit's own gate (cockpit-<id>.mjs) asks whether its room is right; this one asks it of all.
// Run: node scripts/shapes/cockpit-controls.mjs   (exit 1 on any failure)
import { shellFaces, shellProfileFor, SHELL_CLASS } from '../../client/shared/interior-shell.js';
import { drakeHotspots } from '../../client/shared/interior-drake.js';
import { KIT_TRACE } from '../../client/shared/interior-kit.js';
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
  bridge: 'the wheelhouse has no hotspots; helm-view.js is its panel',
};
const isBoat = (cls) => cls === 'hydro' || (!!BOAT_ROWS[cls] && !SHELL_CLASS[cls]);
const flight = (cls) => !NOT_FLIGHT[cls] && !isBoat(cls);

// Live states between them: power off and on, day and night, gear and flaps at both ends, armed. A
// control that only appears in some of them is still a control.
const STATES = [
  { powered: true, engineOn: true, throttle: 0.5, rpm: 0.8, ias: 110, alt: 4500, hdg: 90, fuel: 0.6, hull: 1, hour: 12, gearDown: true },
  { powered: true, engineOn: true, throttle: 1, rpm: 1, ias: 160, alt: 9000, hdg: 200, fuel: 0.2, hull: 0.5, hour: 23,
    panelLight: true, landingLight: true, dome: true, flapNotch: 3, gearDown: false, weaponsArmed: true, stickX: 1, stickY: -1 },
  { powered: false, throttle: 0, rpm: 0, hour: 2, gearDown: true },
];

const { ACT, TIP, KINDS } = readDkTables();
ok(!!ACT && !!TIP && !!KINDS, 'could not read DK_ACT, DK_TIP or the hotspot kinds out of cockpit.js; every check below would pass on nothing');

let seats = 0, controls = 0;
for (const [name, cls, armed, trim] of SEATS) {
  const P = shellProfileFor(cls, armed, trim);
  if (!P) continue;
  seats++;
  const mirrored = new Map();
  KIT_TRACE.mirrored = (str, o) => mirrored.set(str, o);
  const hs = new Map();
  for (const live of STATES) {
    // Built first: the Drake records where its levers and stores landed while it draws them.
    shellFaces(P, live);
    const list = cls === 'drake' ? drakeHotspots(live) : (typeof P.hotspots === 'function' ? P.hotspots(live) : []);
    for (const h of list || []) hs.set(h.id, h.kind);
  }
  KIT_TRACE.mirrored = null;

  // a) every control does something, and says what.
  if (flight(cls) && ACT && TIP && KINDS) {
    for (const [id, kind] of hs) {
      controls++;
      ok(KINDS.has(kind), name + ': ' + id + ' is a "' + kind + '" hotspot, a kind cockpit.js does nothing with');
      if (kind === 'click') ok(ACT.has(id), name + ': ' + id + ' has no action in cockpit.js DK_ACT, so the click does nothing');
      ok(TIP.has(id), name + ': ' + id + ' has no tooltip in cockpit.js DK_TIP');
    }
  }
  // b) every word reads true from the seat.
  ok(!mirrored.size, name + ': ' + [...mirrored].map(([s, o]) => '"' + s + '" at [' + o.map((x) => x.toFixed(2)).join(', ') + ']').join(', ')
    + ' read mirrored. Its panel faces away from the eye; give it the across and up you read it by (cockpit-lettering.md rule 7)');
}
ok(seats >= 15, 'only ' + seats + ' seats found; shellProfileFor or SHELL_CLASS has changed shape');

console.log('    ' + seats + ' seats · ' + controls + ' flight controls');
console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
