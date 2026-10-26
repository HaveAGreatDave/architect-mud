// DEADBALL pacing: how long each line of the booth holds on air.
//
// It used to be one hold for every line, the slot split evenly: at the live clock about 22
// seconds a line, and at 1:1 about 67. The park played an at-bat in the first 13 to 26 of them
// and then stood still, and a line of chatter held the park still for a whole hold of its own.
// That was the freeze between at-bats.
//
// Now a line holds for about as long as it takes to hear (95 ms a character, the read-aloud
// voice's pace, as hockey's do), and each play is timed by the park's own clock
// (client/game/js/panels/diamond/timing.js, the numbers the 3-D park stages by): the call ends no
// sooner than the play lands (`landBy`) and the call's been said, and the next payload waits for
// what the park does after the landing (`afterLand`: a home run's trot and replay, the field
// walking back). What's left of each plate appearance belongs to the booth (baseball-booth.js),
// whose lines are optional: a slot too short for all of them loses the least needed first,
// spread through the game rather than off its end, and a slot with room to spare is filled by
// scaling every hold, so the booth leaves a little more air between its lines rather than a hole
// after them. A two-man exchange is dropped whole or kept whole.
//
// A payload's `hold` (written by index.js for a sport with `holdSpansGap`) is the time to the
// next payload, booth lines and all, so the park keeps playing through the talk.
//
// Pure: same lines in, same holds out, on every server.
import { landBy, afterLand } from '../../../client/game/js/panels/diamond/timing.js';

const MS_PER_CHAR = 95, HOLD_BASE_MS = 900;
export const HOLD_MIN_MS = 3000, HOLD_MAX_MS = 24000;

// What's said, without a speaker's "Name says" wrapper.
const spoken = (text) => { const s = String(text || '').trim(); const m = /^(.+?) says, "([\s\S]*)"$/.exec(s); return m ? m[2] : s; };
export function holdFor(text, graphic) {
  let ms = HOLD_BASE_MS + spoken(text).length * MS_PER_CHAR;
  if (graphic && graphic.duration) ms = Math.max(ms, graphic.duration * 1000 + 400);
  return Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, ms));
}
// A half-inning's changeover and the fly-in to the park before the first pitch ('arrive') aren't plays.
const isPlay = (n) => !!(n.gameday && n.gameday.phase !== 'half' && n.gameday.phase !== 'arrive');
// A play's lines: the one carrying its payload, the talk after it, and the call (`call`, its
// own line when the payload led on the booth's talk; the payload's line itself otherwise).
// From the payload to the end of the call has to cover the pitches, the play and the call, or
// the line after the call airs before the ball lands. The talk before the call is the booth's
// to size (it ends by the landing); here the call's hold makes up the rest.
function playGroups(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isPlay(lines[i])) continue;
    let c = i;
    if (lines[i].gameday.lead) for (let k = i + 1; k < lines.length && !lines[k].gameday; k++) if (lines[k].call) { c = k; break; }
    let end = i + 1;
    while (end < lines.length && !lines[end].gameday) end++;
    out.push({ i, c, end });
  }
  return out;
}
// The time from the payload to the end of its call, given the time to the next payload.
const landMs = (n, spanMs) => Math.round(landBy({ ...n.gameday, hold: spanMs }) * 1000);
const playNeed = (n, call, spanMs) => landMs(n, spanMs) + holdFor(call.text, call.graphic);
// The least time to the next payload that lands the play and leaves the park its after, given
// what the lines already add up to. The budget grows with the span, so it's found by stepping.
const spanNeed = (n, have) => { let s = have; for (let k = 0; k < 6; k++) s = Math.max(have, landMs(n, s) + Math.round(afterLand(n.gameday) * 1000)); return s; };
// One play, settled: the call ends no sooner than the play lands and the call's been said, and
// the next payload waits for the park's after. The talk after the call gives up time to the call
// first, down to its floor, and only then does the play take more of the slot. The budget is a
// share of the span, so each second added moves the landing too; the steps converge.
function settle(n, pre, call, post, get, set, floorOf, tick) {
  const up = (ms) => Math.ceil(ms / tick) * tick;
  const sum = (list) => list.reduce((a, m) => a + get(m), 0);
  for (let step = 0; step < 12; step++) {
    const span = sum(pre) + get(call) + sum(post);
    let short = playNeed(n, call, span) - (sum(pre) + get(call));
    for (let k = 0; k < post.length && short > 0; k++) {
      const m = post[k], take = Math.min(Math.max(0, get(m) - floorOf(m)), up(short));
      set(m, get(m) - take); set(call, get(call) + take); short -= take;
    }
    if (short > 0) set(call, get(call) + up(short));
    const span2 = sum(pre) + get(call) + sum(post);
    const after = spanNeed(n, span2) - span2;
    const last = post.length ? post[post.length - 1] : call;
    if (after > 0) set(last, get(last) + up(after));
    if (short <= 0 && after <= 0) break;
  }
}

// `lines` are the game's say nodes in air order. A booth line's `_opt` is { p, g }: its
// priority (lower goes first) and its group (a two-man exchange shares one). Returns
// { holds: Map(node -> ms), dropped: Set(node) }.
export function paceCalls(lines, fillMs, tickMs, { maxScale = 3 } = {}) {
  const nat = new Map(lines.map((n) => [n, holdFor(n.text, n.graphic)]));
  // the call's natural hold makes up what the talk before it leaves of the play's time; again
  // once the cut has thinned the talk
  // and the group's last line makes up the span the park wants after the landing
  const boost = (list) => {
    for (const { i, c, end } of playGroups(list)) {
      for (let k = c; k < end; k++) nat.set(list[k], holdFor(list[k].text, list[k].graphic));
      settle(list[i], list.slice(i, c), list[c], list.slice(c + 1, end), (m) => nat.get(m), (m, v) => nat.set(m, v), (m) => holdFor(m.text, m.graphic), 1);
    }
  };
  boost(lines);
  const sum = (list) => list.reduce((a, n) => a + nat.get(n), 0);
  const dropped = new Set();
  let live = lines;
  let over = sum(live) - fillMs;
  if (over > 0) {
    // the booth's groups, least needed first, and within a priority spread through the game:
    // each group's place along the game, stepped by the golden ratio, orders the cut
    const groups = new Map();
    lines.forEach((n, i) => {
      if (!n._opt || n.gameday || n.call) return;
      const key = n._opt.g ?? `l${i}`;
      if (!groups.has(key)) groups.set(key, { p: n._opt.p ?? 1, at: i, nodes: [] });
      groups.get(key).nodes.push(n);
    });
    const order = [...groups.values()].sort((a, b) => a.p - b.p || ((a.at * 0.618034) % 1) - ((b.at * 0.618034) % 1));
    for (const g of order) {
      if (over <= 0) break;
      for (const n of g.nodes) { dropped.add(n); over -= nat.get(n); }
    }
    live = lines.filter((n) => !dropped.has(n));
    boost(live);
  }
  const total = Math.max(1, sum(live));
  const scale = Math.min(maxScale, Math.max(0.7, fillMs / total));
  const q = (ms) => Math.max(tickMs, Math.floor(ms / tickMs) * tickMs);
  const floor = (m) => q(holdFor(m.text, m.graphic));
  const holds = new Map(live.map((n) => [n, q(nat.get(n) * scale)]));
  // Settle each play against its real time to the next payload. The talk before the call goes
  // no longer than the play takes to land, its lines cut back to their floor from the last, and
  // the call holds long enough for the rest, taking it from the talk after the call. Moving time
  // inside one payload's span leaves the span, and so the pitches' budget, as it was.
  for (const { i, c, end } of playGroups(live)) {
    const pre = live.slice(i, c), post = live.slice(c + 1, end);
    // talk that would run past the landing is cut back to its floor, last lines first
    const preMs = () => pre.reduce((a, m) => a + holds.get(m), 0);
    const spanMs = () => preMs() + holds.get(live[c]) + post.reduce((a, m) => a + holds.get(m), 0);
    for (let k = pre.length - 1; k >= 1 && preMs() > landMs(live[i], spanMs()); k--) {
      const m = pre[k], spare = Math.min(Math.max(0, holds.get(m) - floor(m)), Math.ceil((preMs() - landMs(live[i], spanMs())) / tickMs) * tickMs);
      holds.set(m, holds.get(m) - spare); holds.set(live[c], holds.get(live[c]) + spare);
    }
    settle(live[i], pre, live[c], post, (m) => holds.get(m), (m, v) => holds.set(m, v), floor, tickMs);
  }
  return { holds, dropped };
}
