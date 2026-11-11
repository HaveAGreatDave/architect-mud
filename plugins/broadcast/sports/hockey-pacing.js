// CPhL pacing: how long each spoken line holds on air, and when the rink should do what
// each line says.
//
// Every other sport gives every line the same hold. That suited a booth that said a long
// sentence a beat; it does not suit one that calls the play in short lines, where "Over to
// Draganov." would sit on screen as long as a forty-word paragraph. So a line holds for
// about as long as it takes to hear: a short floor, then 95 ms a character, which is the
// read-aloud voice's own pace (see `nodeHoldMs` in index.js), and long enough for any card
// riding it. The whole game is then scaled to fill its share of the slot, within limits,
// so the play-by-play neither crawls nor rushes. A line is never squeezed below its
// natural hold (optional lines are cut first), so the rink isn't left chasing the words.
//
// A slot too short for the game at the tightest scale loses lines marked optional, colour
// first (`_opt: 'colour'`, the old sentence-length calls), then the optional calls of the
// play (misses in a long fight, where a saved puck went, the second touch of a routine
// rush), longest first within each. The line that carries a gameday payload is never
// optional.
//
// THE CUES. The narrator tags a line with the moment of play it describes (`_cue`: a touch
// of the rush, the release, a punch, the hit). Here those become times, in ms from the
// start of the line that carried the payload, written onto that payload as `cues`. The
// rink reads them and does each thing as its line airs, so a screen reader and the picture
// arrive together. Pure: same lines in, same holds and cues out, on every server.
//
// THE BREAK. An intermission runs from its payload to the line that carries `resume`, and it
// has to be long enough for the Zamboni to do the sheet at a driver's pace in front of a seat
// in the stands and the last strip to freeze: BREAK_MS, against 324 s for the pattern. The booth doesn't talk all through
// it. The silence is handed back as `gaps` (node → ms of nothing after it), shared out after
// every line of the break but the last, so the sign-off still lands just before the teams.
// The time comes out of the slot's spare tail first (`spareMs`), then out of the play. A
// short slot gets a shorter break, and the rink speeds the machine up to fit it.

export const HOLD_MIN_MS = 3000, HOLD_MAX_MS = 16000;
const MS_PER_CHAR = 95, HOLD_BASE_MS = 1300;
// A drawn-out word ("SCOOOOORES") holds its sound about a sixth of a second a letter, more
// than the 95 ms the letter itself buys, so each held letter after the first earns this.
const MS_PER_HELD = 60;

export const BREAK_MS = 390000;
// (no more than this share of the air goes to breaks, however short the slot)
const BREAK_SHARE = 0.3;

// Each run of lines from an intermission's payload to the line that brings the period back.
// The intermission after the last period has no such line, and stays as long as its words.
// So does the one before overtime: a third long break cost a tied game too much of its play,
// and the rink speeds the machine up to fit it.
function breaksIn(lines) {
  const out = [];
  let run = null;
  for (const n of lines) {
    if (n.gameday) run = n.gameday.type === 'intermission' ? [] : null;
    if (!run) continue;
    const back = n._cue && [].concat(n._cue).find((c) => c.ev === 'resume');
    if (back) { if (!back.sudden) out.push(run); run = null; continue; }
    run.push(n);
  }
  return out;
}

export function holdFor(text, graphic) {
  const s = String(text || '').trim();
  const held = (s.match(/([A-Za-z])\1{2,}/g) || []).reduce((a, run) => a + run.length - 1, 0);
  let ms = HOLD_BASE_MS + s.length * MS_PER_CHAR + held * MS_PER_HELD;
  if (graphic && graphic.duration) ms = Math.max(ms, graphic.duration * 1000 + 400);
  return Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, ms));
}

// `lines` are the game's say nodes in air order. Returns { holds: Map(node → ms), gaps:
// Map(node → ms), dropped: Set(node) } and writes `cues` onto every gameday payload among
// the kept lines.
export function paceCalls(lines, fullMs, tickMs, { minScale = 1, maxScale = 1.5, spareMs = 0 } = {}) {
  const nat = new Map(lines.map((n) => [n, holdFor(n.text, n.graphic)]));
  const sum = (list) => list.reduce((a, n) => a + nat.get(n), 0);
  const dropped = new Set();
  // the silence the breaks will need, taken off what the lines may fill
  const runs = breaksIn(lines);
  const breakMs = runs.length ? Math.min(BREAK_MS, (fullMs + spareMs) * BREAK_SHARE / runs.length) : 0;
  const silence = runs.reduce((a, r) => a + Math.max(0, breakMs - sum(r) * 0.7), 0);
  const fillMs = fullMs + spareMs - silence;
  let live = lines;
  let over = sum(live) * minScale - fillMs;
  if (over > 0) {
    const rank = (n) => (n._opt === 'colour' ? 0 : 1);
    const cut = lines.filter((n) => n._opt && !n.gameday).sort((a, b) => rank(a) - rank(b) || nat.get(b) - nat.get(a));
    for (const n of cut) { if (over <= 0) break; dropped.add(n); over -= nat.get(n) * minScale; }
    live = lines.filter((n) => !dropped.has(n));
  }
  // Still too long once the optional lines are gone (a clock much faster than the default
  // three-to-one), the holds compress further rather than run the game off the end of its
  // slot, down to a floor where the voice starts to fall behind.
  const floor = sum(live) * minScale > fillMs ? 0.6 : minScale;
  const scale = Math.min(maxScale, Math.max(floor, fillMs / Math.max(1, sum(live))));
  const q = (ms) => Math.max(tickMs, Math.round(ms / tickMs) * tickMs);
  const holds = new Map(live.map((n) => [n, q(nat.get(n) * scale)]));
  const gaps = new Map();
  for (const run of breaksIn(live)) {
    // a desk segment (sequences.js) plays straight through, and the silence is left to the booth's lines
    const talk = run.reduce((a, n) => a + holds.get(n), 0), between = run.slice(0, -1).filter((n) => n.graphic?.overlayType !== 'desk');
    const each = q(Math.max(0, breakMs - talk) / Math.max(1, between.length));
    if (breakMs > talk) for (const n of between.length ? between : run) gaps.set(n, each);
  }
  let gd = null, acc = 0;
  for (const n of live) {
    if (n.gameday) { gd = n.gameday; gd.cues = []; acc = 0; }
    // (a line can carry two moments of play: a breakaway's spring is the pass and the call)
    if (gd && n._cue) for (const c of [].concat(n._cue)) gd.cues.push({ ms: acc, ...c });
    acc += holds.get(n) + (gaps.get(n) || 0);
  }
  return { holds, gaps, dropped };
}
