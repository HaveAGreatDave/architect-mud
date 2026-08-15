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
import { makeBudget, applyCaptures, compileRow, splitGag } from '../../client/game/js/automation-guards.js';
import { VAR_NAME_RE } from '../../client/game/js/variables.js';
import { evaluate, evalBool, evalValue } from '../../client/game/js/expr.js';

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
