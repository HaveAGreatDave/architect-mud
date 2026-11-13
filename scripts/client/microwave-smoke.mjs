// Microwave smoke: the Kitchen Stage's microwave, the parts with no scene (kitchen-microwave.js).
//
//   1. THE KEYPAD. Digits go in from the right as a microwave's do: 1, 3, 0 is 1:30 and 90 seconds,
//      90 is 90 seconds, +30 adds half a minute and carries, Clear empties, four digits is the most, a
//      leading 0 is nothing, and the time never passes the server's cap.
//   2. THE SEQUENCE. The door is shut by the slam; the finger is on START at the jab and gone after;
//      the shots go slam, pad, wide; stepping through it in small steps fires every beat once, in
//      order, and the jab (which sends the command) fires exactly once; from a shut door it starts at
//      the keypad and never slams.
//   3. THE LETTERING. Every verdict there's an end state for has words, and every drawing call runs on
//      a stand-in 2-D context without throwing.
//
// Run:  node scripts/client/microwave-smoke.mjs

const MW = await import('../../client/game/js/panels/kitchen-microwave.js');

let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${name}${info === undefined ? '' : '  ' + JSON.stringify(info)}`); } };
const type = (keys, d = '') => keys.reduce((s, k) => MW.padPress(s, k), d);

// ── 1. the keypad ─────────────────────────────────────────────────────────────────────────────
check('keypad: 1 3 0 reads 1:30', MW.padText(type(['1', '3', '0'])) === '1:30', MW.padText(type(['1', '3', '0'])));
check('keypad: 1 3 0 is ninety seconds', MW.padSecs(type(['1', '3', '0'])) === 90);
check('keypad: 9 0 is ninety seconds too', MW.padSecs(type(['9', '0'])) === 90);
check('keypad: nothing typed reads 0:00 and is no time', MW.padText('') === '0:00' && MW.padSecs('') === 0);
check('keypad: a leading 0 is nothing', type(['0', '0', '5']) === '5');
check('keypad: four digits is the most', type(['1', '2', '3', '4', '5']) === '1234');
check('keypad: back takes a digit off', type(['1', '2', 'back']) === '1');
check('keypad: Clear empties it', type(['1', '2', 'C']) === '' && type(['4', 'clear']) === '');
check('keypad: +30 on nothing is half a minute', MW.padSecs(type(['+30'])) === 30 && MW.padText(type(['+30'])) === '0:30');
check('keypad: +30 on 1:00 carries to 1:30', MW.padText(type(['1', '0', '0', '+30'])) === '1:30');
check('keypad: +30 on 0:45 carries into the minute', MW.padText(type(['4', '5', '+30'])) === '1:15', MW.padText(type(['4', '5', '+30'])));
check('keypad: +30 stops at the cap', MW.padSecs(type(Array(30).fill('+30'))) === MW.MAX_SECS);
check('keypad: a stray key changes nothing', type(['1', 'x']) === '1');
check('keypad: the cap is the server\'s ten minutes', MW.MAX_SECS === 600);
check('clock: 90.2 s reads 1:31 (it counts up to the second)', MW.clockText(90.2) === '1:31');
check('clock: 59 s reads 0:59, and done reads 0:00', MW.clockText(59) === '0:59' && MW.clockText(-3) === '0:00');
check('digits: 90 s types as 130', MW.toDigits(90) === '130' && MW.toDigits(45) === '45' && MW.toDigits(0) === '');

// ── 2. the sequence ───────────────────────────────────────────────────────────────────────────
const Q = MW.SEQ;
check('sequence: the door starts open', MW.seqAt(0).door === 1);
check('sequence: the door is shut by the slam', MW.seqAt(Q.slam).door < 0.05 && MW.seqAt(Q.slam + 0.4).door === 0);
check('sequence: the door only ever closes, bar its one bounce', MW.seqAt(Q.slam * 0.5).door > MW.seqAt(Q.slam * 0.9).door);
check('sequence: no finger at the slam', MW.seqAt(Q.slam).finger === 0);
check('sequence: the finger creeps before it jabs', MW.seqAt(Q.creep + 0.3).finger > 0 && MW.seqAt(Q.creep + 0.3).finger < MW.seqAt(Q.wind).finger + 1e-9);
check('sequence: the finger is on START at the jab', MW.seqAt(Q.jab).finger === 1);
check('sequence: and gone once it cuts back', MW.seqAt(Q.back + 0.01).finger === 0);
check('sequence: it trembles while it creeps, not after', MW.seqAt(Q.creep + 0.2).tremble && !MW.seqAt(Q.jab + 0.05).tremble);
const shots = [];
for (let t = 0; t <= Q.end; t += 0.01) { const s = MW.seqAt(t).shot; if (shots[shots.length - 1] !== s) shots.push(s); }
check('sequence: the shots go slam, pad, wide', shots.join() === 'slam,pad,wide', shots);
const fired = [];
let last = -1;
for (let t = 0; t <= Q.end + 0.05; t += 1 / 60) { fired.push(...MW.eventsBetween(last, t)); last = t; }
check('sequence: every beat fires once, in order', fired.join() === MW.SEQ_EVENTS.map((e) => e.id).join(), fired);
check('sequence: the jab (the command) fires exactly once', fired.filter((x) => x === 'jab').length === 1);
const shut = [];
last = MW.FROM_SHUT;
for (let t = MW.FROM_SHUT; t <= Q.end + 0.05; t += 1 / 60) { shut.push(...MW.eventsBetween(last, t)); last = t; }
check('sequence: from a shut door it never slams, and still jabs', !shut.includes('slam') && shut.includes('jab') && shut.includes('end'), shut);
check('sequence: from a shut door it starts on the keypad', MW.seqAt(MW.FROM_SHUT + 0.03).shot === 'pad');
check('sequence: a big step still crosses every beat', MW.eventsBetween(-1, 99).length === MW.SEQ_EVENTS.length);
check('sequence: it says SLAM, BEEP and hums', ['SLAM!', 'BEEP!'].every((w) => [Q.slam + 0.1, Q.jab + 0.1].some((t) => MW.seqAt(t).words.some((x) => x.text === w)))
  && MW.seqAt(Q.back + 0.3).words.some((x) => x.kind === 'hum'));
check('sequence: done at the end', MW.seqAt(Q.end).done && !MW.seqAt(Q.end - 0.01).done);

// ── 3. the lettering ──────────────────────────────────────────────────────────────────────────
// the end states quality.js stateAt names
for (const s of ['raw', 'peak', 'over', 'burnt']) check(`verdict: ${s} has words and colours`, !!MW.VERDICT[s]?.text && /^#/.test(MW.VERDICT[s].fill) && /^#/.test(MW.VERDICT[s].ink));
check('verdict: only burnt smokes', Object.entries(MW.VERDICT).every(([k, v]) => !!v.smoke === (k === 'burnt')));
let calls = 0;
const g = new Proxy({}, {
  get(o, k) {
    if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
    if (k in o) return o[k];
    return () => { calls++; };
  },
  set(o, k, v) { o[k] = v; return true; },
});
let threw = null;
try {
  for (const age of [0, 0.05, 0.3, 0.9]) {
    MW.drawBurst(g, 100, 100, 80, 'SLAM!', { age, life: 1 });
    MW.drawBurst(g, 100, 100, 80, 'A VERY LONG VERDICT INDEED', { age, life: 1, seed: 3 });
    MW.drawCaption(g, 1280, 720, 'THE MOMENT HAS COME.', { age, life: 1 });
    MW.drawHum(g, 640, 200, 30, 'MMMMMMMMM', { age, life: 1, t: age });
  }
  MW.drawFocusLines(g, 1280, 720, 600, 400, 0.8, 1);
  MW.drawFocusLines(g, 1280, 720, 600, 400, 0, 1);
} catch (e) { threw = String(e?.stack || e); }
check('lettering: every drawing call runs', !threw && calls > 100, threw || calls);

console.log(`microwave-smoke: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
