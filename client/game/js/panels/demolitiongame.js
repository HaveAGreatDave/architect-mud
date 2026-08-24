// DEMOLITION — the two games, with no drawing in them at all.
//
// This is the vaultcrack.js pattern and it exists for one reason: the middle
// Display Mode rung has to be the SAME GAME, not a described version of one. If
// the graphical panel and the character panel each owned their own loop they
// would drift on the first tuning pass, and 'same difficulty curve' would be a
// promise rather than a fact. So the state machine lives here, both skins drive
// it, and neither can drift because there is only one of it.
//
// A skin is: { board(st), status(html), frame(st), finish(st, won) }.
//
// ── THE RIG GAME ────────────────────────────────────────────────────────────
// Set a fuse, then seat three leads. A needle sweeps a track; you commit and it
// lands inside the tolerance band or it doesn't. Skill widens the band, the
// target's difficulty speeds the needle. Three good seatings arm it; three bad
// ones ruin the charge.
//
// The fuse is the interesting choice and it is made BEFORE the skill test, so it
// is a decision rather than a reward: short pays (nobody has time to find it) and
// short is what you have to walk out through.
//
// ── THE DEFUSE GAME ─────────────────────────────────────────────────────────
// Leads in a loom, one of them the shunt. A meter reads tension on any lead you
// probe, and the shunt is the one reading against the run — deducible, never a
// guess, which is the whole difference between this and picking a colour.
//
// ⚠ Probing SPENDS THE REAL CLOCK. The server is still counting down; this board
// cannot pause it and must never pretend to. Running the clock out here does not
// 'lose' — it closes, and the charge goes off on the server exactly as it was
// always going to.

let _skin = null;
let _st = null;
let _raf = 0;

export function setDemoSkin(skin) { _skin = skin; }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Rig ─────────────────────────────────────────────────────────────────────

const LEADS_TO_SEAT = 3;

export function startRig({ skill = 4, difficulty = 5, fuseMin = 10, fuseMax = 120, fuseDefault = 45 } = {}) {
  stop();
  _st = {
    kind: 'rig',
    phase: 'fuse',                 // 'fuse' → 'seat' → over
    fuse: clamp(fuseDefault, fuseMin, fuseMax),
    fuseMin, fuseMax,
    // Band is the whole skill expression: a rank-1 hand gets 14% of the track,
    // a rank-10 hand gets a third of it. Never below 8% or the game is a coin
    // flip with extra steps.
    band: clamp(0.10 + skill * 0.024, 0.08, 0.34),
    speed: 0.55 + difficulty * 0.075, // track-widths per second
    pos: 0, dir: 1,
    seated: 0, fumbles: 0,
    over: false, won: false,
    last: null,                    // 'good' | 'bad', for the skin to flash
  };
  _skin?.board?.(_st);
  loop();
  return _st;
}

export function rigFuse(delta) {
  if (!_st || _st.kind !== 'rig' || _st.phase !== 'fuse') return;
  _st.fuse = clamp(_st.fuse + delta, _st.fuseMin, _st.fuseMax);
  _skin?.board?.(_st);
}

export function rigArm() {
  if (!_st || _st.kind !== 'rig' || _st.phase !== 'fuse') return;
  _st.phase = 'seat';
  _skin?.board?.(_st);
}

// The one input the seating phase takes. Deliberately a single verb — this is a
// reflex test, and a reflex test with a menu isn't one.
export function rigCommit() {
  if (!_st || _st.kind !== 'rig' || _st.over) return;
  if (_st.phase === 'fuse') return rigArm();
  const centre = 0.5;
  const good = Math.abs(_st.pos - centre) <= _st.band / 2;
  if (good) { _st.seated++; _st.last = 'good'; }
  else { _st.fumbles++; _st.last = 'bad'; }
  // Every seating is harder than the last — you are working closer to a live
  // detonator each time, and a flat difficulty made the third lead a formality.
  _st.speed *= good ? 1.18 : 1.06;
  if (_st.seated >= LEADS_TO_SEAT) finish(true);
  else if (_st.fumbles >= 3) finish(false);
  else _skin?.board?.(_st);
}

// ── Defuse ──────────────────────────────────────────────────────────────────

const COLOURS = ['red', 'blue', 'green', 'amber', 'white', 'grey'];

export function startDefuse({ skill = 4, difficulty = 5, seconds = 30 } = {}) {
  stop();
  const count = clamp(3 + Math.floor(difficulty / 2), 3, 6);
  const cols = COLOURS.slice(0, count);
  const shunt = Math.floor(Math.random() * count);
  // Tension readings: the run sits in a band, the shunt sits outside it. The
  // rule is legible after two probes and never needs a third to CONFIRM — a
  // deduction game whose answer is only ever probable is a guessing game.
  const runBase = 40 + Math.floor(Math.random() * 20);
  const leads = cols.map((colour, i) => ({
    colour,
    tension: i === shunt ? runBase + (Math.random() < 0.5 ? -22 : 22) : runBase + Math.floor(Math.random() * 7) - 3,
    probed: false,
    cut: false,
  }));
  // Skill shows you some of the loom for free — a practised hand recognises a
  // shunt sleeve on sight. Never enough to hand you the answer outright.
  const free = clamp(Math.floor((skill - 3) / 2), 0, count - 2);
  for (let i = 0; i < free; i++) {
    const un = leads.filter(l => !l.probed && leads.indexOf(l) !== shunt);
    if (un.length) pick(un).probed = true;
  }
  _st = {
    kind: 'defuse',
    leads, shunt,
    endsAt: performance.now() + seconds * 1000,
    seconds,
    probeCost: 2,                  // seconds off the real clock, per probe
    cursor: 0,
    over: false, won: false,
    note: '',
  };
  _skin?.board?.(_st);
  loop();
  return _st;
}

export function defuseMove(delta) {
  if (!_st || _st.kind !== 'defuse' || _st.over) return;
  _st.cursor = (_st.cursor + delta + _st.leads.length) % _st.leads.length;
  _skin?.board?.(_st);
}

export function defuseProbe(index = _st?.cursor) {
  if (!_st || _st.kind !== 'defuse' || _st.over) return;
  const lead = _st.leads[index];
  if (!lead || lead.probed) return;
  lead.probed = true;
  // The cost is taken off the clock the player can see, because the clock the
  // player can see is the real one.
  _st.endsAt -= _st.probeCost * 1000;
  _st.note = `Meter on the ${lead.colour} lead: ${lead.tension} mV.`;
  _skin?.board?.(_st);
}

export function defuseCut(index = _st?.cursor) {
  if (!_st || _st.kind !== 'defuse' || _st.over) return;
  const lead = _st.leads[index];
  if (!lead || lead.cut) return;
  lead.cut = true;
  finish(index === _st.shunt);
}

export function defuseSecondsLeft() {
  if (!_st || _st.kind !== 'defuse') return 0;
  return Math.max(0, (_st.endsAt - performance.now()) / 1000);
}

// ── Shared loop ─────────────────────────────────────────────────────────────

function loop() {
  let last = performance.now();
  const step = (now) => {
    if (!_st || _st.over) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (_st.kind === 'rig' && _st.phase === 'seat') {
      _st.pos += _st.dir * _st.speed * dt;
      if (_st.pos >= 1) { _st.pos = 1; _st.dir = -1; }
      if (_st.pos <= 0) { _st.pos = 0; _st.dir = 1; }
    }
    if (_st.kind === 'defuse' && defuseSecondsLeft() <= 0) {
      // Out of time is NOT a loss — it is the board closing on a bomb that is
      // still going to go off. The skin reports nothing; the server already owns
      // what happens next.
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

export function stop() {
  cancelAnimationFrame(_raf); _raf = 0;
  _st = null;
}

export function demoState() { return _st; }
