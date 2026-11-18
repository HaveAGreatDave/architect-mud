// Rink rules: the linesman in Rinkside's between-plays game (rink/sim.js `linesman`).
//
// Offside and icing as the NHL has them now, each set up by hand on a bare world and
// stepped until the puck crosses the line:
// - carried in with a man of his over the line: offside at once, the draw at the
//   neutral-zone dot outside that zone, on the side it happened;
// - dumped in with a man over: delayed. Tagging up waves it off; one of his touching the
//   puck before they have is offside;
// - the other side carrying it back into their own end puts nobody offside;
// - played from his own side of the red line over their goal line: icing, the draw in his
//   end on the dot the other side's centre wants, unless one of his wins the race to it
//   (hybrid icing), his side is a man short, or it was put in from over the red line.
//
// No DOM beyond the stub, no server, no database. Run:  node scripts/shapes/rink-rules.mjs

import { __install } from './rink-dom-stub.mjs';

__install();
const { createIce } = await import('../../client/game/js/panels/rink/textures.js');
const { createWorld } = await import('../../client/game/js/panels/rink/sim.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { BLUE_X, GOAL_X, MID_Y } = await import('../../client/game/js/panels/rink/geo.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

const ice = createIce(globalThis.document);
// A world with everybody standing where he's put (scripted, so the between-plays game
// doesn't move him) and the linesman's calls taken by a stand-in for the director.
function setup(place) {
  const W = createWorld(ice, 'rules');
  const calls = [], events = [];
  W.onCall = (c) => { calls.push(c); W.frozen = true; return true; };
  const emit = W.emit; W.emit = (n, d) => { if (n === 'call') events.push(d.call); return emit(n, d); };
  for (const side of ['a', 'h']) {
    W.team[side].forEach((m, i) => {
      // (out of the way: the D at the far end of their own half, the forwards at centre)
      const x = side === 'a' ? 40 + i * 4 : 160 - i * 4;
      Object.assign(m, { x, y: 10 + i * 12, vx: 0, vy: 0, scripted: true, tx: x, ty: 10 + i * 12, maxV: 20 });
    });
  }
  W.officials.forEach((o) => { o.scripted = true; o.tx = o.x; o.ty = o.y; });
  place(W);
  return { W, calls, events };
}
const man = (W, side, slot, x, y, tx = x, ty = y, maxV = 20) => Object.assign(W.team[side][slot], { x, y, vx: 0, vy: 0, tx, ty, maxV });
const steps = (W, secs, until) => { for (let t = 0; t < secs; t += DT) { W.step(DT); if (until && until()) return true; } return false; };

// ── offside ───────────────────────────────────────────────────────────────────
{
  // a carries it in along the low boards with his winger already in their zone
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 1, BLUE_X[1] - 8, 30, BLUE_X[1] + 30, 30, 14);
    man(W, 'a', 0, BLUE_X[1] + 6, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
  });
  steps(W, 4, () => calls.length);
  check('carried in with a man over the line is offside', calls.length === 1 && calls[0].call === 'offside' && calls[0].side === 'a', JSON.stringify(calls));
  check('the offside draw is at the neutral dot outside their zone, on its side', calls[0] && calls[0].dot === 'hNL', calls[0] && calls[0].dot);
}
{
  // the same, with nobody over: no call
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 1, BLUE_X[1] - 8, 30, BLUE_X[1] + 30, 30, 14);
    man(W, 'a', 0, BLUE_X[1] - 4, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
  });
  steps(W, 4);
  check('carried in with everybody onside is no call', calls.length === 0 && W.calls.zone.a, JSON.stringify(calls));
}
{
  // h carries it in toward the low end (its attacking zone) with a man in: offside, the draw
  // outside a's zone
  const { W, calls } = setup((W) => {
    const c = man(W, 'h', 1, BLUE_X[0] + 8, 60, BLUE_X[0] - 30, 60, 14);
    man(W, 'h', 2, BLUE_X[0] - 6, 70);
    W.puck.x = c.x - 1.5; W.puck.y = c.y; W.give(c, true);
  });
  steps(W, 4, () => calls.length);
  check('the other way, offside at the dot outside the other zone', calls.length === 1 && calls[0].side === 'h' && calls[0].dot === 'aNR', JSON.stringify(calls));
}
{
  // dumped in with a man over: delayed; he tags up and it's waved off
  const { W, calls, events } = setup((W) => {
    const c = man(W, 'a', 1, BLUE_X[1] - 12, 30);
    man(W, 'a', 0, BLUE_X[1] + 10, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
    W.dumpTo(c, GOAL_X[1] - 6, 8, 50);
  });
  steps(W, 1.5, () => W.calls.delayed);
  check('dumped in with a man over is a delayed offside, not a whistle', !!W.calls.delayed && calls.length === 0 && events.includes('delayed'), `${events} / ${JSON.stringify(calls)}`);
  const off = W.team.a[0]; off.tx = BLUE_X[1] - 4; off.maxV = 24;
  steps(W, 4, () => !W.calls.delayed);
  check('every man back out to the line waves it off (the tag-up)', !W.calls.delayed && events.includes('tagged') && calls.length === 0, `${events}`);
}
{
  // dumped in with a man over, and he plays it before tagging up: offside
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 1, BLUE_X[1] - 12, 30);
    man(W, 'a', 0, BLUE_X[1] + 10, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
    W.dumpTo(c, GOAL_X[1] - 30, 22, 40);
  });
  steps(W, 1.5, () => W.calls.delayed);
  // (it's put on his stick: what's under test is the touch, not how he got to it)
  const off = W.team.a[0];
  W.puck.x = off.x + 1.5; W.puck.y = off.y; W.puck.vx = W.puck.vy = 0; W.give(off, true);
  steps(W, 1, () => calls.length);
  check('touched by one of them before they have all tagged up is offside', calls.length === 1 && calls[0].call === 'offside' && calls[0].side === 'a', JSON.stringify(calls));
}
{
  // h carries it back into its own end with a's man still in there: not offside
  const { W, calls, events } = setup((W) => {
    const c = man(W, 'h', 3, BLUE_X[1] - 8, 40, BLUE_X[1] + 30, 40, 14);
    man(W, 'a', 0, BLUE_X[1] + 12, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
  });
  steps(W, 4);
  check('the other side carrying it into its own end puts nobody offside', calls.length === 0 && !events.includes('delayed'), `${events} / ${JSON.stringify(calls)}`);
}

// ── icing ─────────────────────────────────────────────────────────────────────
const fire = (W, c) => { W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true); W.dumpTo(c, GOAL_X[1] + 6, 25, 84); };
{
  // a fires it from its own end; h's D is nearer: icing, in a's end
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 3, 60, 30);
    man(W, 'h', 3, 170, 30);
    for (const m of W.team.a) if (m !== c) { m.x = Math.min(m.x, 95); m.tx = m.x; }
    fire(W, c);
  });
  steps(W, 6, () => calls.length);
  const cH = W.team.h.find((m) => m.slot === 1), want = `aZ${((cH.hand === 'R' ? -1 : 1) * -1) > 0 ? 'R' : 'L'}`;
  check('fired over their goal line from his own half is icing', calls.length === 1 && calls[0].call === 'icing' && calls[0].side === 'a', JSON.stringify(calls));
  check('the icing draw is in his own end, on the side their centre wants', calls[0] && calls[0].dot === want, `${calls[0] && calls[0].dot} vs ${want}`);
}
{
  // hybrid: one of a's is going to get there first, so it's waved off
  const { W, calls, events } = setup((W) => {
    const c = man(W, 'a', 3, 60, 30);
    man(W, 'a', 0, GOAL_X[1] - 4, 26);
    for (const m of W.team.h) { m.x = Math.min(m.x, 120); m.tx = m.x; }
    fire(W, c);
  });
  steps(W, 6, () => events.includes('waved') || calls.length);
  check('hybrid icing: one of his wins the race and it is waved off', calls.length === 0 && events.includes('waved'), `${events} / ${JSON.stringify(calls)}`);
}
{
  // a man short may ice it
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 3, 60, 30);
    man(W, 'h', 3, 170, 30);
    W.team.a[2].active = false;
    fire(W, c);
  });
  steps(W, 6, () => calls.length);
  check('a side a man short is not called for icing', calls.length === 0 && W.calls.n.short === 1, `${JSON.stringify(calls)} short ${W.calls.n.short}`);
}
{
  // put in from over the red line it's a dump-in, not icing
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 1, 106, 30);
    man(W, 'h', 3, 170, 30);
    fire(W, c);
  });
  steps(W, 6);
  check('put in from over the red line is not icing', calls.length === 0, JSON.stringify(calls));
}
{
  // a play the director is staging is the sim's: never called
  const { W, calls } = setup((W) => {
    const c = man(W, 'a', 1, BLUE_X[1] - 8, 30, BLUE_X[1] + 30, 30, 14);
    man(W, 'a', 0, BLUE_X[1] + 6, 20);
    W.puck.x = c.x + 1.5; W.puck.y = c.y; W.give(c, true);
    W.puckScripted = true;
  });
  steps(W, 4);
  check('nothing is called through a staged play', calls.length === 0, JSON.stringify(calls));
}

console.log(`rink rules: ${passes}/${passes + failures} passed`);
process.exit(failures ? 1 : 0);
