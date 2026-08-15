// The macro language's expression evaluator.
//
// What replaced `CMP_RE` — a single regex that matched exactly one shape,
// `<name> <op> <number>`. Everything about the old grammar's limits came from
// that line: no boolean operators at all (so `if $hp_pct < 30 and has bandage`
// could not be written), and a NUMBER on the right-hand side, which meant no
// trigger capture could ever be branched on, because every capture is a string.
//
// Pure by construction: no imports, no DOM, no globals. The world arrives through
// a resolver object, which is what lets the whole thing be tested headlessly
// (scripts/client/automation-smoke.mjs) and is the same reasoning that put the
// automation guards in their own file.
//
// ── The rules that are decisions rather than mechanics ──────────────────────
//
//   • A BARE WORD IS A VARIABLE IF ONE EXISTS, AND OTHERWISE ITS OWN TEXT. That
//     is what makes `if $zone == bishops` work without anybody having to learn
//     when to quote. The cost is that a mistyped variable name compares as a
//     string rather than erroring, which is the same trade every shell makes and
//     the right one for a language typed into a textarea.
//
//   • COMPARISON IS NUMERIC WHEN BOTH SIDES LOOK NUMERIC, AND OTHERWISE
//     CASE-INSENSITIVE STRING. `10 > 9` is true and so is `"Enforcer" ==
//     "enforcer"`. Everything else in this DSL is already case-insensitive; a
//     comparison that suddenly was not would be the surprise.
//
//   • `+` CONCATENATES WHEN EITHER SIDE IS NOT A NUMBER. `1 + 1` is 2 and
//     `"a" + "b"` is "ab". Two operators would be more correct and would mean
//     explaining to a player which one they wanted.
//
//   • AN ERROR IS NEVER THROWN AT THE CALLER. A malformed expression evaluates
//     to `null`, and the condition it belongs to reads as false. This is
//     evaluated from inside the log's append path (a trigger's condition) and
//     from inside a loop; an exception in either is much worse than a branch not
//     being taken.

// ── Tokenizer ───────────────────────────────────────────────────────────────
const OPERATOR_WORDS = new Set(['and', 'or', 'not', 'contains', 'starts', 'ends', 'has', 'lacks', 'in', 'notin']);
const PUNCT = ['<=', '>=', '==', '!=', '<>', '<', '>', '=', '+', '-', '*', '/', '(', ')', ','];

function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    // A quoted string is the escape hatch for anything with a space or an
    // operator character in it — an item called "field bandage", a zone called
    // "Bishop's Blend".
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, buf = '';
      while (j < s.length && s[j] !== quote) { buf += s[j]; j++; }
      if (j >= s.length) return null;            // unterminated — the whole thing is malformed
      out.push({ t: 'str', v: buf });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i, buf = '';
      while (j < s.length && /[0-9.]/.test(s[j])) { buf += s[j]; j++; }
      out.push({ t: 'num', v: Number(buf) });
      i = j;
      continue;
    }
    if (c === '$' || /[a-z_]/i.test(c)) {
      let j = c === '$' ? i + 1 : i, buf = '';
      while (j < s.length && /[a-z0-9_]/i.test(s[j])) { buf += s[j]; j++; }
      if (!buf) return null;
      const lower = buf.toLowerCase();
      // A `$` prefix forces a variable read; without it, an operator word is an
      // operator. `$has` is the variable `has`, `has` is the operator — which is
      // what lets somebody keep a variable with an unlucky name.
      if (c !== '$' && OPERATOR_WORDS.has(lower)) out.push({ t: 'op', v: lower });
      else out.push({ t: 'ident', v: buf, forced: c === '$' });
      i = j;
      continue;
    }
    const p = PUNCT.find(x => s.startsWith(x, i));
    if (!p) return null;                          // a character with no meaning here
    out.push({ t: 'op', v: p });
    i += p.length;
  }
  return out;
}

// ── Values ──────────────────────────────────────────────────────────────────
function isNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string' || v.trim() === '') return false;
  return Number.isFinite(Number(v));
}

function truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (isNumeric(v)) return Number(v) !== 0;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'false' && s !== 'no';
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

function compare(a, b, op) {
  let x = a, y = b;
  if (isNumeric(a) && isNumeric(b)) { x = Number(a); y = Number(b); }
  else { x = str(a).toLowerCase(); y = str(b).toLowerCase(); }
  switch (op) {
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    case '>=': return x >= y;
    case '==': case '=': return x === y;
    case '!=': case '<>': return x !== y;
    default: return false;
  }
}

// ── Built-in functions ──────────────────────────────────────────────────────
//
// Deliberately a short list of string operations and nothing else. These exist
// because every trigger capture is a string, and the commonest thing anybody
// wants to do with one is compare it after tidying it up. Anything needing more
// than this is asking for a real language, which is a different decision.
const FUNCS = {
  lower: (a) => str(a).toLowerCase(),
  upper: (a) => str(a).toUpperCase(),
  trim: (a) => str(a).trim(),
  len: (a) => str(a).length,
  // 1-indexed, because every other count a player meets in this game is.
  word: (a, n) => str(a).trim().split(/\s+/)[Math.max(1, Math.floor(Number(n) || 1)) - 1] ?? '',
  num: (a) => (isNumeric(a) ? Number(a) : 0),
  round: (a) => Math.round(Number(a) || 0),
  abs: (a) => Math.abs(Number(a) || 0),
  min: (a, b) => Math.min(Number(a) || 0, Number(b) || 0),
  max: (a, b) => Math.max(Number(a) || 0, Number(b) || 0),
};

export const FUNC_NAMES = Object.keys(FUNCS);

// ── Parser ──────────────────────────────────────────────────────────────────
//
// Ordinary recursive descent, lowest precedence outermost:
//   or → and → not → comparison → additive → multiplicative → unary → primary
class Parser {
  constructor(tokens, res) { this.k = tokens; this.i = 0; this.res = res; }
  peek() { return this.k[this.i]; }
  eat(v) {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === v) { this.i++; return true; }
    return false;
  }

  parse() {
    const v = this.or();
    if (this.i !== this.k.length) throw new Error('trailing tokens');
    return v;
  }

  or() {
    let a = this.and();
    while (this.eat('or')) { const b = this.and(); a = truthy(a) || truthy(b); }
    return a;
  }

  and() {
    let a = this.not();
    while (this.eat('and')) { const b = this.not(); a = truthy(a) && truthy(b); }
    return a;
  }

  not() {
    if (this.eat('not')) return !truthy(this.not());
    return this.comparison();
  }

  comparison() {
    let a = this.additive();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') return a;
      if (['<', '<=', '>', '>=', '==', '=', '!=', '<>'].includes(t.v)) {
        this.i++;
        a = compare(a, this.additive(), t.v);
      } else if (t.v === 'contains') {
        this.i++;
        a = str(a).toLowerCase().includes(str(this.additive()).toLowerCase());
      } else if (t.v === 'starts') {
        this.i++;
        a = str(a).toLowerCase().startsWith(str(this.additive()).toLowerCase());
      } else if (t.v === 'ends') {
        this.i++;
        a = str(a).toLowerCase().endsWith(str(this.additive()).toLowerCase());
      } else return a;
    }
  }

  additive() {
    let a = this.multiplicative();
    for (;;) {
      if (this.eat('+')) {
        const b = this.multiplicative();
        // Numbers add; anything else joins. See the header note on why this is
        // one operator and not two.
        a = (isNumeric(a) && isNumeric(b)) ? Number(a) + Number(b) : str(a) + str(b);
      } else if (this.eat('-')) {
        a = (Number(a) || 0) - (Number(this.multiplicative()) || 0);
      } else return a;
    }
  }

  multiplicative() {
    let a = this.unary();
    for (;;) {
      if (this.eat('*')) a = (Number(a) || 0) * (Number(this.unary()) || 0);
      else if (this.eat('/')) {
        const b = Number(this.unary()) || 0;
        // ⚠ Division by zero yields 0, never Infinity. A macro that echoes
        // "Infinity" has failed in a way nobody can debug from the log.
        a = b === 0 ? 0 : (Number(a) || 0) / b;
      } else return a;
    }
  }

  unary() {
    if (this.eat('-')) return -(Number(this.unary()) || 0);
    // `has`/`lacks`/`in`/`notin` are unary operators over ONE token — a bare word
    // or a quoted string. The old whole-condition forms (`has field bandage`,
    // unquoted and multi-word) still work; they are matched before this ever runs
    // (parseCond in smartbar-macros.js), so nothing already written breaks. Inside
    // an expression, a name with a space in it must be quoted.
    const t = this.peek();
    if (t && t.t === 'op' && ['has', 'lacks', 'in', 'notin'].includes(t.v)) {
      this.i++;
      const operand = str(this.primary());
      if (t.v === 'has') return !!this.res.has?.(operand);
      if (t.v === 'lacks') return !this.res.has?.(operand);
      if (t.v === 'in') return !!this.res.inZone?.(operand);
      return !this.res.inZone?.(operand);
    }
    return this.primary();
  }

  primary() {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') { this.i++; return t.v; }
    if (t.t === 'str') { this.i++; return t.v; }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const v = this.or();
      if (!this.eat(')')) throw new Error('unclosed (');
      return v;
    }
    if (t.t === 'ident') {
      this.i++;
      const name = t.v.toLowerCase();
      // A function call is an identifier immediately followed by '('.
      if (FUNCS[name] && this.peek() && this.peek().t === 'op' && this.peek().v === '(') {
        this.i++;
        const args = [];
        if (!this.eat(')')) {
          do { args.push(this.or()); } while (this.eat(','));
          if (!this.eat(')')) throw new Error('unclosed call');
        }
        return FUNCS[name](...args);
      }
      const v = this.res.lookup?.(name);
      if (v !== null && v !== undefined) return v;
      // Unknown name with a forced `$` stays empty rather than becoming the
      // literal text: `$nothing == ""` should be true, and `"$nothing"` printed
      // into a command is the bug interpolation already guards against.
      return t.forced ? '' : t.v;
    }
    throw new Error('unexpected token');
  }
}

/**
 * Evaluate an expression. Returns its value, or `null` when the expression is
 * malformed — never throws (see the header).
 *
 * @param {string} src
 * @param {{lookup?: (name:string)=>any, has?: (token:string)=>boolean,
 *          inZone?: (token:string)=>boolean}} resolver
 */
export function evaluate(src, resolver = {}) {
  const text = String(src ?? '').trim();
  if (!text) return null;
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return null;
  try { return new Parser(tokens, resolver).parse(); }
  catch { return null; }
}

// Can this be parsed at all? For the editor's Check button, which needs to tell
// a typo apart from a condition that is merely false — without it a malformed
// expression passes Check and then silently never fires, which is the single
// worst thing a validator can do.
//
// Evaluating with an empty resolver is a safe way to ask: unknown names resolve
// to their own text rather than throwing, so the only way to get null back is a
// genuine parse failure.
export function isWellFormed(src) {
  return evaluate(src, {}) !== null;
}

// Evaluate as a condition. A malformed expression is FALSE, never an error and
// never true — the old parseCond returned null for anything it could not read and
// the branch was skipped, and that behaviour is load-bearing for every macro
// already written.
export function evalBool(src, resolver = {}) {
  const v = evaluate(src, resolver);
  return v === null ? false : truthy(v);
}

// Evaluate for a value to store or print. Returns the ORIGINAL text when the
// expression is malformed, so `set name Marsh Devlin` stores the words rather
// than becoming empty — most `set` values are prose, not arithmetic.
export function evalValue(src, resolver = {}) {
  const v = evaluate(src, resolver);
  if (v === null) return String(src ?? '');
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}
