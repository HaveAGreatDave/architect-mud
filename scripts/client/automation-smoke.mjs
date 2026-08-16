// Headless coverage for the automation guards and the macro variable store —
// the two pieces of the client automation layer where being wrong is expensive
// rather than merely wrong.
//
// The guards are the reason this file exists. A trigger fires commands, commands
// produce lines, and lines fire triggers; every check that stops that being a
// loop lives in client/game/js/automation-guards.js, and reviewing it is not the
// same as testing it. No DOM, no browser, no network — both modules are pure by
// construction so that this test can exist.
import assert from 'node:assert/strict';
import { makeBudget, applyCaptures, compileRow, splitGag, splitChannel, splitPrefixes } from '../../client/game/js/automation-guards.js';
import { waitForLine, offerLine, cancelAllWaits, pendingWaits } from '../../client/game/js/linewait.js';
import { VAR_NAME_RE } from '../../client/game/js/variables.js';
import { evaluate, evalBool, evalValue } from '../../client/game/js/expr.js';
import { expandSpeedwalk } from '../../client/game/js/speedwalk.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n      ↳ ${e.message}`); process.exitCode = 1; }
}

console.log('\nautomation guards');

// ── The budget ──────────────────────────────────────────────────────────────
check('a budget allows up to its limit', () => {
  const b = makeBudget({ max: 3, windowMs: 1000, now: () => 0 });
  assert.equal(b.allow(), true);
  assert.equal(b.allow(), true);
  assert.equal(b.allow(), true);
  assert.equal(b.allow(), false, 'the fourth must be refused');
});

check('…and refuses everything after, not every other one', () => {
  const b = makeBudget({ max: 2, windowMs: 1000, now: () => 0 });
  b.allow(); b.allow();
  for (let i = 0; i < 20; i++) assert.equal(b.allow(), false);
});

check('the window SLIDES — the burst-across-the-boundary hole is closed', () => {
  // The bug a plain "reset the counter every N ms" counter has: 2 fires at the
  // very end of one window and 2 at the very start of the next is 4 in a
  // fraction of a second, and a resetting counter waves all four through.
  let t = 0;
  const b = makeBudget({ max: 2, windowMs: 1000, now: () => t });
  t = 990; assert.equal(b.allow(), true);
  t = 995; assert.equal(b.allow(), true);
  t = 1010; assert.equal(b.allow(), false, 'still inside 1000ms of the first two');
});

check('…and does forgive once the window has genuinely passed', () => {
  let t = 0;
  const b = makeBudget({ max: 2, windowMs: 1000, now: () => t });
  b.allow(); b.allow();
  t = 2000;
  assert.equal(b.allow(), true);
});

check('reset clears it', () => {
  const b = makeBudget({ max: 1, windowMs: 1000, now: () => 0 });
  b.allow();
  assert.equal(b.allow(), false);
  b.reset();
  assert.equal(b.allow(), true);
});

// ── Captures ────────────────────────────────────────────────────────────────
check('captures substitute by index', () => {
  assert.equal(applyCaptures('attack $1', ['x', 'enforcer']), 'attack enforcer');
});

check('$0 is the whole match', () => {
  assert.equal(applyCaptures('say $0', ['a dog barks', 'dog']), 'say a dog barks');
});

check('an absent group becomes empty, NEVER the literal $3', () => {
  // Sending `attack $3` to the server answers "Unknown command" and the player
  // has no way to tell which trigger did it.
  assert.equal(applyCaptures('attack $3', ['whole', 'one']), 'attack ');
  assert.ok(!applyCaptures('attack $3', ['whole']).includes('$'));
});

check('no match at all substitutes to empty rather than throwing', () => {
  assert.equal(applyCaptures('go $1', null), 'go ');
});

check('$10 is $1 followed by a zero', () => {
  assert.equal(applyCaptures('$10', ['w', 'north']), 'north0');
});

// ── Compiling ───────────────────────────────────────────────────────────────
check('a plain pattern is a case-insensitive substring', () => {
  const r = compileRow({ pattern: 'You Are Bleeding', regex: false });
  assert.ok(r.test('the wound reopens — you are bleeding badly'));
  assert.equal(r.test('nothing of the sort'), null);
});

check('a regex pattern captures', () => {
  const r = compileRow({ pattern: '^(\\w+) hits you', regex: true });
  const m = r.test('Enforcer hits you hard');
  assert.equal(m[1], 'Enforcer');
});

check('⚠ a broken regex marks the row broken and NEVER throws', () => {
  // This runs inside the log append path. An exception here takes the whole log
  // down, on every line, until a reload — caused by a player typing a bracket.
  const r = compileRow({ pattern: '([unclosed', regex: true });
  assert.equal(r.broken, true);
  assert.doesNotThrow(() => r.test('any line at all'));
  assert.equal(r.test('any line at all'), null);
});

check('an empty pattern compiles to nothing rather than matching everything', () => {
  assert.equal(compileRow({ pattern: '', regex: false }), null);
  assert.equal(compileRow(null), null);
});

check('a plain pattern with regex metacharacters is taken literally', () => {
  const r = compileRow({ pattern: 'hp: 12 (low)', regex: false });
  assert.ok(r.test('HP: 12 (LOW)'));
});

// ── Gag ─────────────────────────────────────────────────────────────────────
check('a script with no gag is untouched', () => {
  const g = splitGag('bandage;look');
  assert.equal(g.gag, false);
  assert.equal(g.gagOnly, false);
  assert.equal(g.cmds, 'bandage;look');
});

check('a bare gag is gagOnly and leaves nothing to run', () => {
  // gagOnly is what exempts a trigger from the re-entrancy guard and the budget,
  // so it must be exactly "runs no commands" and never merely "mentions gag".
  const g = splitGag('gag');
  assert.equal(g.gag, true);
  assert.equal(g.gagOnly, true);
  assert.equal(g.cmds, '');
});

check('gag alongside commands hides the line AND still runs them', () => {
  const g = splitGag('gag;say I saw that');
  assert.equal(g.gag, true);
  assert.equal(g.gagOnly, false, 'it has commands, so it CAN loop and must be budgeted');
  assert.equal(g.cmds, 'say I saw that');
});

check('gag is recognised whatever the case and wherever it sits', () => {
  assert.equal(splitGag('look;GAG').gag, true);
  assert.equal(splitGag('look\ngag\nsay hi').cmds, 'look;say hi');
});

check('a command merely containing the word gag is not a gag', () => {
  const g = splitGag('say gag me');
  assert.equal(g.gag, false);
  assert.equal(g.cmds, 'say gag me');
});

check('compileRow carries the gag verdict through', () => {
  const r = compileRow({ pattern: 'x', regex: false, cmds: 'gag' });
  assert.equal(r.gag, true);
  assert.equal(r.gagOnly, true);
});

// ── Channel matching ────────────────────────────────────────────────────────
check('@channel splits off the front of a pattern', () => {
  assert.deepEqual(splitChannel('@loot a rusted pipe'), { channel: 'loot', rest: 'a rusted pipe' });
  assert.deepEqual(splitChannel('@combat-incoming'), { channel: 'combat-incoming', rest: '' });
});

check('a pattern with no @ is left alone', () => {
  assert.deepEqual(splitChannel('you are bleeding'), { channel: null, rest: 'you are bleeding' });
});

check('⚠ an @ in the middle is not a channel', () => {
  // Otherwise a line quoting an address or a handle would be read as scoping.
  assert.deepEqual(splitChannel('mail from bishop@thorn'), { channel: null, rest: 'mail from bishop@thorn' });
});

check('a channel restricts what the row matches', () => {
  const r = compileRow({ pattern: 'pipe', regex: false, channel: 'loot', cmds: 'take pipe' });
  assert.ok(r.test('a rusted pipe', 'loot'));
  assert.equal(r.test('a rusted pipe', 'say'), null, 'right text, wrong channel');
  assert.equal(r.test('nothing here', 'loot'), null, 'right channel, wrong text');
});

check('a channel with no pattern matches every line on it', () => {
  const r = compileRow({ pattern: '', regex: false, channel: 'death', cmds: 'say oh' });
  assert.ok(r.test('anything at all', 'death'));
  assert.equal(r.test('anything at all', 'loot'), null);
});

check('no channel means every channel', () => {
  const r = compileRow({ pattern: 'pipe', regex: false, cmds: 'x' });
  assert.ok(r.test('a pipe', 'loot'));
  assert.ok(r.test('a pipe', undefined));
});

check('#group splits off the front, and combines with @channel either way round', () => {
  assert.deepEqual(splitPrefixes('#combat you are hit'), { channel: null, group: 'combat', rest: 'you are hit' });
  assert.deepEqual(splitPrefixes('@say #chat hello'), { channel: 'say', group: 'chat', rest: 'hello' });
  assert.deepEqual(splitPrefixes('#chat @say hello'), { channel: 'say', group: 'chat', rest: 'hello' });
  assert.deepEqual(splitPrefixes('plain'), { channel: null, group: null, rest: 'plain' });
});

check('a multi-line row compiles with dotAll so . spans the joins', () => {
  // Without it every multi-line pattern would have to be written with [\s\S],
  // which is how people conclude the feature does not work.
  const r = compileRow({ pattern: 'opens.+inside', regex: true, lines: 3, cmds: 'x' });
  assert.ok(r.test('the door opens\nslowly\nsomething inside stirs'));
});

check('lines is clamped to a sane window', () => {
  assert.equal(compileRow({ pattern: 'x', regex: false, lines: 999, cmds: 'y' }).lines, 10);
  assert.equal(compileRow({ pattern: 'x', regex: false, lines: 0, cmds: 'y' }).lines, 1);
  assert.equal(compileRow({ pattern: 'x', regex: false, cmds: 'y' }).lines, 1);
});

console.log('\nwait for a line');

{
  const p = waitForLine((s) => (s.includes('dies') ? [s] : null), 5000);
  offerLine('the enforcer dies', 'combat');
  const r = await p;
  check('a matching line wakes a parked script', () => {
    assert.equal(r.matched, true);
    assert.equal(r.line, 'the enforcer dies');
  });
}

{
  const r = await waitForLine(() => null, 20);
  check('⚠ a wait ALWAYS times out rather than parking forever', () => {
    // A script parked forever is indistinguishable from the client having hung,
    // and `stop` cannot reach a runner that is not on a step boundary.
    assert.equal(r.matched, false);
  });
}

{
  const a = waitForLine((s) => (s.includes('x') ? [s] : null), 5000);
  const b = waitForLine((s) => (s.includes('x') ? [s] : null), 5000);
  offerLine('x', null);
  const [ra, rb] = await Promise.all([a, b]);
  check('every waiter on a line is woken, not just the first', () => {
    assert.equal(ra.matched, true);
    assert.equal(rb.matched, true);
  });
}

{
  // ⚠ The re-entrancy case: a woken waiter's continuation registers a NEW waiter
  // synchronously. If offerLine walked the live array it would skip the next one.
  let second = null;
  const first = waitForLine((s) => (s === 'one' ? [s] : null), 5000).then(() => {
    second = waitForLine((s) => (s === 'two' ? [s] : null), 5000);
  });
  const other = waitForLine((s) => (s === 'one' ? [s] : null), 5000);
  offerLine('one', null);
  await first;
  const r = await other;
  check('a waiter registered from inside a wake-up does not corrupt the walk', () => {
    assert.equal(r.matched, true, 'the second waiter on the same line still fired');
    assert.ok(second, 'and the new waiter was registered');
  });
  cancelAllWaits();
}

{
  const p = waitForLine(() => null, 5000);
  const n = cancelAllWaits();
  const r = await p;
  check('stop wakes everything with a miss', () => {
    assert.equal(n, 1);
    assert.equal(r.matched, false);
    assert.equal(pendingWaits(), 0);
  });
}

check('a throwing test does not take the offer down', () => {
  const p = waitForLine(() => { throw new Error('bad'); }, 20);
  assert.doesNotThrow(() => offerLine('anything', null));
  cancelAllWaits();
  return p;
});

console.log('\ncommand stacking');

// Mirrors isStacked() in input.js. Restated rather than imported because input.js
// reaches the DOM at module scope; if the rule there changes and this does not,
// the divergence is the point of the test.
const FREE_TEXT = new Set(['say', 'shout', 'yell', 'whisper', 'tell', 'ooc', 'emote',
  'me', 'echo', 'chat', 'radio', 'note', 'describe', 'macro']);
const stacked = (line) => {
  const verb = String(line).trim().split(/\s+/)[0].toLowerCase();
  if (FREE_TEXT.has(verb)) return false;
  if (String(line).includes(';;')) return false;
  return String(line).includes(';');
};

check('a plain chain stacks', () => {
  assert.equal(stacked('n;n;e'), true);
  assert.equal(stacked('get all;south'), true);
});

check('a lone command does not', () => {
  assert.equal(stacked('look'), false);
});

check('⚠ a free-text verb is NEVER split', () => {
  // The commonest thing anybody types with a semicolon in it. Splitting turns
  // half of somebody's sentence into a command.
  assert.equal(stacked('say meet me at the bar; I will be late'), false);
  assert.equal(stacked('tell marsh hello; how are you'), false);
  assert.equal(stacked('emote grins; then leaves'), false);
});

check(';; suppresses splitting for the whole line', () => {
  assert.equal(stacked('note buy milk;;eggs'), false);
  assert.equal(stacked('look;;here'), false);
});

console.log('\nexpression evaluator');

// The world the macro language would hand it.
const R = {
  lookup: (n) => ({ hp: 42, hp_pct: 25, count: '3', zone: 'Bishops Blend', empty: '' }[n] ?? null),
  has: (t) => ['bandage', 'pipe'].includes(String(t).toLowerCase()),
  inZone: (t) => String(t).toLowerCase() === 'bishops',
};

check('arithmetic, with precedence and parens', () => {
  assert.equal(evalValue('3 + 4', R), '7');
  assert.equal(evalValue('2 + 3 * 4', R), '14');
  assert.equal(evalValue('(2 + 3) * 4', R), '20');
  assert.equal(evalValue('10 - 25', R), '-15');
  assert.equal(evalValue('-5 + 2', R), '-3');
});

check('divide by zero is 0, never Infinity', () => {
  // A macro that echoes "Infinity" has failed in a way nobody can debug.
  assert.equal(evalValue('5 / 0', R), '0');
});

check('⚠ boolean operators exist at all — the old grammar had none', () => {
  // `if $hp_pct < 30 and has bandage` was literally unwritable before.
  assert.equal(evalBool('$hp_pct < 30 and has bandage', R), true);
  assert.equal(evalBool('$hp_pct < 30 and has rifle', R), false);
  assert.equal(evalBool('$hp_pct > 90 or has pipe', R), true);
  assert.equal(evalBool('not has rifle', R), true);
});

check('⚠ comparison against a STRING — the other half of what CMP_RE forbade', () => {
  // Every trigger capture is a string, so this is what made captures useless.
  assert.equal(evalBool('$zone == "Bishops Blend"', R), true);
  assert.equal(evalBool('$zone == bishops', R), false);
  assert.equal(evalBool('$zone contains bishops', R), true);
});

check('string comparison ignores case, like everything else in the DSL', () => {
  assert.equal(evalBool('"Enforcer" == enforcer', R), true);
  assert.equal(evalBool('$zone starts BISHOPS', R), true);
  assert.equal(evalBool('$zone ends blend', R), true);
});

check('numeric comparison stays numeric when both sides look it', () => {
  assert.equal(evalBool('10 > 9', R), true);      // not the string "10" < "9"
  assert.equal(evalBool('$count < 10', R), true); // a user var stored as text
});

check('a bare word is a variable if one exists, else its own text', () => {
  assert.equal(evalValue('hp', R), '42');
  assert.equal(evalValue('bishops', R), 'bishops');
});

check('a forced $name that is unset is empty, not the literal text', () => {
  assert.equal(evalValue('$nothing', R), '');
  assert.equal(evalBool('$nothing == ""', R), true);
});

check('+ concatenates when either side is not a number', () => {
  assert.equal(evalValue('1 + 1', R), '2');
  assert.equal(evalValue('"a" + "b"', R), 'ab');
  assert.equal(evalValue('"hp is " + $hp', R), 'hp is 42');
});

check('string functions', () => {
  assert.equal(evalValue('lower("ENFORCER")', R), 'enforcer');
  assert.equal(evalValue('upper(abc)', R), 'ABC');
  assert.equal(evalValue('trim("  x  ")', R), 'x');
  assert.equal(evalValue('len(abcd)', R), '4');
  assert.equal(evalValue('word("one two three", 2)', R), 'two');
  assert.equal(evalValue('max(3, 9)', R), '9');
});

check('has / in work inside an expression, not just as a whole condition', () => {
  assert.equal(evalBool('has bandage', R), true);
  assert.equal(evalBool('lacks rifle', R), true);
  assert.equal(evalBool('in bishops', R), true);
  assert.equal(evalBool('notin bishops', R), false);
});

check('⚠ a malformed expression is FALSE and never throws', () => {
  // This is evaluated from inside the log append path (a trigger condition) and
  // from inside a loop. The old parseCond returned null for anything it could
  // not read and the branch was skipped; that behaviour is load-bearing for
  // every macro already written.
  assert.doesNotThrow(() => evalBool('( 1 +', R));
  assert.equal(evalBool('( 1 +', R), false);
  assert.equal(evalBool('"unterminated', R), false);
  assert.equal(evalBool('%%%', R), false);
  assert.equal(evaluate('', R), null);
});

check('⚠ evalValue keeps the original text when it is not an expression', () => {
  // Most `set` values are prose. `set name Marsh Devlin` must store the words.
  assert.equal(evalValue('Marsh Devlin', R), 'Marsh Devlin');
  assert.equal(evalValue('the bar on fourth', R), 'the bar on fourth');
});

check('the old numeric-comparison shape still means what it always did', () => {
  // Backward compatibility for every macro already written against CMP_RE.
  assert.equal(evalBool('hp_pct < 50', R), true);
  assert.equal(evalBool('$hp_pct >= 25', R), true);
  assert.equal(evalBool('hp != 42', R), false);
  assert.equal(evalBool('hp <> 41', R), true);
  assert.equal(evalBool('hp = 42', R), true);
});

console.log('\nspeedwalk');

check('a count expands', () => {
  assert.equal(expandSpeedwalk('3n'), 'north;north;north');
  assert.equal(expandSpeedwalk('3n2e'), 'north;north;north;east;east');
});

check('an implied count of one works between counted runs', () => {
  assert.equal(expandSpeedwalk('2nw'), 'northwest;northwest');
  assert.equal(expandSpeedwalk('2n e'), null, 'a space means it is not a speedwalk');
  assert.equal(expandSpeedwalk('2ne'), 'northeast;northeast');
});

check('two-letter directions beat one-letter ones', () => {
  // Otherwise `ne` reads as `n` followed by a stranded `e`.
  assert.equal(expandSpeedwalk('1ne'), 'northeast');
  assert.equal(expandSpeedwalk('1n1e'), 'north;east');
});

check('⚠ `use` IS NOT A SPEEDWALK — the trap the digit rule exists for', () => {
  // u-s-e are all direction letters. The naive "only direction letters" test
  // turns a verb people type constantly into up-south-east.
  assert.equal(expandSpeedwalk('use'), null);
  assert.equal(expandSpeedwalk('sew'), null);
  assert.equal(expandSpeedwalk('wed'), null);
  assert.equal(expandSpeedwalk('dune'), null);
  assert.equal(expandSpeedwalk('sun'), null);
});

check('a bare direction is left to the server alias', () => {
  assert.equal(expandSpeedwalk('n'), null);
  assert.equal(expandSpeedwalk('nnn'), null, 'digitless, so not a speedwalk');
});

check('anything with a non-direction character is not one', () => {
  assert.equal(expandSpeedwalk('2n orc'), null);
  assert.equal(expandSpeedwalk('get all'), null);
  assert.equal(expandSpeedwalk('3x'), null);
  assert.equal(expandSpeedwalk('look'), null);
});

check('a runaway count is refused rather than walked', () => {
  // 99n is a typo far more often than an intention, and the honest answer to a
  // typo is to do nothing — it falls through and the server says so.
  assert.equal(expandSpeedwalk('99n'), null);
  assert.equal(expandSpeedwalk('0n'), null);
});

check('a trailing digit with no direction is refused', () => {
  assert.equal(expandSpeedwalk('3n2'), null);
});

console.log('\nconfig sync (the arrival rule)');

// configsync.js reads localStorage for its stamps. Node has none, so stand one up
// — the module only ever calls getItem/setItem.
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

const cfg = await import('../../client/game/js/configsync.js');

function harness(localValue, localStampSec) {
  let store = localValue;
  const sent = [];
  cfg.setConfigTransport((m) => sent.push(m));
  cfg.registerConfig('triggers', { load: () => store, replace: (p) => { store = p; } });
  globalThis.localStorage._d.clear();
  if (localStampSec) globalThis.localStorage.setItem('architect_cfg_at_triggers', String(localStampSec));
  return { sent, get store() { return store; } };
}

check('never synced + local content → PUSH (the migration case)', () => {
  // Everybody already using triggers has them in a browser only. They must not
  // have to re-enter them for the account to start carrying them.
  const h = harness([{ id: 'a' }], 0);
  cfg.receiveConfig({});
  assert.deepEqual(h.store, [{ id: 'a' }], 'local is kept');
});

check('never synced + nothing local → do nothing at all', () => {
  // A store that has never been touched must not claim the key and stamp it, or a
  // device that DOES have rules is later told to adopt emptiness.
  const h = harness([], 0);
  cfg.receiveConfig({});
  assert.equal(h.sent.length, 0);
});

check('server is newer → ADOPT', () => {
  const h = harness([{ id: 'old' }], 100);
  cfg.receiveConfig({ triggers: { payload: [{ id: 'new' }], updatedAt: 200 } });
  assert.deepEqual(h.store, [{ id: 'new' }]);
});

check('⚠ an EMPTY list from a server with a row is a DELETION, and is adopted', () => {
  // The whole reason this rule lives in one file. Reading empty as "nothing up
  // there yet" pushes the local copy back and resurrects every rule the player
  // just deleted on another device — on every login, forever.
  const h = harness([{ id: 'a' }, { id: 'b' }], 100);
  cfg.receiveConfig({ triggers: { payload: [], updatedAt: 200 } });
  assert.deepEqual(h.store, [], 'the deletion won');
});

check('local edit is newer → PUSH, not adopt', () => {
  // An edit made on a machine that was offline is not garbage.
  const h = harness([{ id: 'mine' }], 300);
  cfg.receiveConfig({ triggers: { payload: [{ id: 'theirs' }], updatedAt: 200 } });
  assert.deepEqual(h.store, [{ id: 'mine' }], 'local survives');
});

check('adopting stamps with the SERVER time, not now', () => {
  // Stamping an adoption with the current clock makes every login look like a
  // local edit and lets a stale device win the next comparison.
  harness([], 0);
  cfg.receiveConfig({ triggers: { payload: [{ id: 'x' }], updatedAt: 12345 } });
  assert.equal(globalThis.localStorage.getItem('architect_cfg_at_triggers'), '12345');
});

check('a throwing provider does not stop the other keys', () => {
  cfg.setConfigTransport(() => {});
  cfg.registerConfig('broken', { load: () => [], replace: () => { throw new Error('nope'); } });
  let ok = null;
  cfg.registerConfig('fine', { load: () => [], replace: (p) => { ok = p; } });
  assert.doesNotThrow(() => cfg.receiveConfig({
    broken: { payload: [1], updatedAt: 5 },
    fine: { payload: [2], updatedAt: 5 },
  }));
  assert.deepEqual(ok, [2]);
});

console.log('\nmacro variables');

check('variable names must start with a letter or underscore', () => {
  assert.ok(VAR_NAME_RE.test('count'));
  assert.ok(VAR_NAME_RE.test('_tmp'));
  assert.ok(VAR_NAME_RE.test('hp_at_start'));
  assert.ok(!VAR_NAME_RE.test('1'), 'a digit name would shadow a $1 capture');
  assert.ok(!VAR_NAME_RE.test('my var'));
  assert.ok(!VAR_NAME_RE.test(''));
});

if (process.exitCode) console.error(`\n  automation smoke FAILED`);
else console.log(`\n  ✓ automation smoke — ${passed} checks passed`);
