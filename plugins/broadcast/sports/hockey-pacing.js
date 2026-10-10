// CPhL pacing: how long each spoken line holds on air, and when the rink should do what
// each line says.
//
// Every other sport gives every line the same hold. That suited a booth that said a long
// sentence a beat; it does not suit one that calls the play in short lines, where "Over to
// Draganov." would sit on screen as long as a forty-word paragraph. So a line holds for
// about as long as it takes to hear: a short floor, then 95 ms a character, which is the
// read-aloud voice's own pace (see `nodeHoldMs` in index.js), and long enough for any card
// riding it. The whole game is then scaled to fill its share of the slot, within limits,
// so the play-by-play neither crawls nor rushes.
//
// A slot too short for the game at the tightest scale loses lines marked optional (colour,
// misses in a long fight, the second touch of a routine rush), longest first. The line that
// carries a gameday payload is never optional.
//
// THE CUES. The narrator tags a line with the moment of play it describes (`_cue`: a touch
// of the rush, the release, a punch, the hit). Here those become times, in ms from the
// start of the line that carried the payload, written onto that payload as `cues`. The
// rink reads them and does each thing as its line airs, so a screen reader and the picture
// arrive together. Pure: same lines in, same holds and cues out, on every server.

export const HOLD_MIN_MS = 2400, HOLD_MAX_MS = 16000;
const MS_PER_CHAR = 95, HOLD_BASE_MS = 900;

export function holdFor(text, graphic) {
  let ms = HOLD_BASE_MS + String(text || '').trim().length * MS_PER_CHAR;
  if (graphic && graphic.duration) ms = Math.max(ms, graphic.duration * 1000 + 400);
  return Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, ms));
}

// `lines` are the game's say nodes in air order. Returns { holds: Map(node → ms), dropped:
// Set(node) } and writes `cues` onto every gameday payload among the kept lines.
export function paceCalls(lines, fillMs, tickMs, { minScale = 0.9, maxScale = 1.5 } = {}) {
  const nat = new Map(lines.map((n) => [n, holdFor(n.text, n.graphic)]));
  const sum = (list) => list.reduce((a, n) => a + nat.get(n), 0);
  const dropped = new Set();
  let live = lines;
  let over = sum(live) * minScale - fillMs;
  if (over > 0) {
    const cut = lines.filter((n) => n._opt && !n.gameday).sort((a, b) => nat.get(b) - nat.get(a));
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
  let gd = null, acc = 0;
  for (const n of live) {
    if (n.gameday) { gd = n.gameday; gd.cues = []; acc = 0; }
    if (gd && n._cue) gd.cues.push({ ms: acc, ...n._cue });
    acc += holds.get(n);
  }
  return { holds, dropped };
}
