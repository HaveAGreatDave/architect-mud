// ALARM DISARM — the game, with no drawing in it at all.
//
// demolitiongame.js's pattern, for demolitiongame.js's reason: the middle Display
// Mode rung has to be the SAME GAME, not a described version of one. If the
// graphical panel and the character panel each owned a loop they would drift on
// the first tuning pass and "same difficulty curve" would be a promise rather
// than a fact. The state machine lives here, both skins drive it, and neither can
// drift because there is only one of it.
//
// A skin is: { board(st), status(html), frame(st), finish(st, won, info) }.
//
// ── THE GAME ────────────────────────────────────────────────────────────────
//
// A row of terminals behind the fascia. One is LIVE, and every terminal carries
// two things: its own tag, and the tag of the terminal the loop runs to next. So
// the chain through the board is READABLE — you find the live one, read where it
// goes, find that tag, latch it, read again. Latch them in order and the loop is
// open before the box notices it was ever closed.
//
// ⚠ THE ANSWER IS ALWAYS DEDUCIBLE AND NEVER A GUESS. That is the defuse board's
// own rule and it is what separates this from picking a colour: at every step
// exactly one terminal carries the tag you are looking for, and it is printed on
// the board in front of you. What the clock takes away is not your knowledge, it
// is your time to LOOK — which is why the pressure reads as pressure rather than
// as a dice roll wearing a costume.
//
// Skill buys STRIKES (how many times you may latch the wrong one) and difficulty
// buys LENGTH and DECOYS. Neither buys time: time is the server's, always.
//
// ⚠ RUNNING THE CLOCK OUT IS NOT A LOSS AND MUST NOT BE REPORTED AS ONE. The
// server's sweep is already counting and is the only authority on whether the
// alarm tripped; a board that reported a loss on expiry would ALSO damage the
// player's deck for a race it never lost — punished twice for one clock. On
// expiry the board simply closes and the box goes off on schedule.

let _skin = null;
let _st = null;
let _raf = 0;

export function setAlarmSkin(skin) { _skin = skin; }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAGS = ['A7', 'B2', 'C9', 'D4', 'E1', 'F8', 'G3', 'H6', 'J5', 'K0'];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startAlarm({ skill = 4, difficulty = 5, seconds = 30, deviceName = 'ALARM' } = {}) {
  // Chain length and decoys both climb with difficulty; the board is never
  // shorter than three links (two is not a chain, it is a switch) and never
  // longer than six (past that it is a memory test the clock has already made).
  const chainLen = clamp(2 + Math.round(difficulty / 2), 3, 6);
  const decoys = clamp(Math.round(difficulty / 3), 1, 4);
  const count = clamp(chainLen + decoys, 4, 10);

  // Strikes are the skill term. A floor of one is deliberate — a novice gets a
  // single mistake, never zero, because a board that ends on your first wrong
  // touch is indistinguishable from one that was lying about being deducible.
  const strikes = clamp(1 + Math.round(skill / 3), 1, 5);

  const tags = shuffled(TAGS).slice(0, count);
  const chain = shuffled(tags).slice(0, chainLen);

  // Every terminal points somewhere. A chain link points at the next link; a
  // decoy points at a random OTHER terminal, so a decoy is not identifiable by
  // having nothing written on it — it has to be ruled out by not being reached.
  const nextOf = {};
  chain.forEach((t, i) => { nextOf[t] = chain[i + 1] || null; });
  for (const t of tags) {
    if (nextOf[t] !== undefined) continue;
    const others = tags.filter(x => x !== t);
    nextOf[t] = others[Math.floor(Math.random() * others.length)];
  }

  _st = {
    kind: 'alarm',
    deviceName,
    terminals: tags.map(t => ({ tag: t, next: nextOf[t], latched: false, burnt: false })),
    chain,
    step: 0,                 // how many links are latched
    strikes, strikesLeft: strikes,
    endsAt: performance.now() + seconds * 1000,
    seconds,
    over: false, won: false,
    note: '',
  };
  // The live terminal is the head of the chain, and it is SHOWN. Hiding it would
  // make the first move a guess, which is the one thing this board must never be.
  _st.terminals.find(t => t.tag === chain[0]).live = true;

  _skin?.board?.(_st);
  loop();
  return _st;
}

export function alarmSecondsLeft() {
  if (!_st) return 0;
  return Math.max(0, (_st.endsAt - performance.now()) / 1000);
}

// The terminal the loop is waiting on. The skins read this to draw the prompt,
// so "what am I looking for" has exactly one implementation.
export function alarmWanted() {
  return _st && !_st.over ? _st.chain[_st.step] : null;
}

export function alarmLatch(index) {
  if (!_st || _st.over) return;
  const term = _st.terminals[index];
  if (!term || term.latched || term.burnt) return;

  if (term.tag === _st.chain[_st.step]) {
    term.latched = true;
    _st.step++;
    if (_st.step >= _st.chain.length) { _st.note = 'Loop open.'; finish(true); return; }
    _st.note = `Latched ${term.tag}. It runs to ${term.next}.`;
    return;
  }

  // Wrong terminal. It burns out, which is information rather than just a
  // penalty — a burnt terminal is one you never have to consider again.
  term.burnt = true;
  _st.strikesLeft--;
  _st.note = `${term.tag} is not on the loop. It burns out.`;
  if (_st.strikesLeft <= 0) { _st.note = 'The panel latches you out.'; finish(false); }
}

export function alarmState() { return _st; }

// ── Shared loop ─────────────────────────────────────────────────────────────
function loop() {
  const step = () => {
    if (!_st || _st.over) return;
    if (alarmSecondsLeft() <= 0) {
      // ⚠ Not a loss. See the header — the board closes, the server's sweep does
      // what it was always going to do, and nothing is reported.
      _st.over = true;
      _skin?.finish?.(_st, false, { expired: true });
      return;
    }
    _skin?.frame?.(_st);
    _raf = requestAnimationFrame(step);
  };
  _raf = requestAnimationFrame(step);
}

function finish(won) {
  if (!_st) return;
  _st.over = true; _st.won = won;
  cancelAnimationFrame(_raf); _raf = 0;
  _skin?.finish?.(_st, won, {});
}

export function stopAlarm() {
  cancelAnimationFrame(_raf); _raf = 0;
  _st = null;
}
