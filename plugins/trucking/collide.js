// THE LONG HAUL — two trucks in the same place.
//
// Everything the collision system did until now was one body against the WORLD: a rig, a building,
// a rebound, one bill. Two trucks is a different problem and it is worth being precise about why,
// because the difference is the entire design here.
//
// A wall does not have an owner, a speed, or a claim about where it was. Another truck has all
// three, and both drivers' clients think they are authoritative about their own position. So:
//
//  1. THE SERVER DETECTS IT, not the client. Each rig's position is already server-side (it is
//     reconciled from telemetry four times a second) and a pair test over the handful of live rigs
//     is nothing. A client-reported truck-on-truck would let either party invent a crash the other
//     never had — and, more mundanely, would double-report every real one.
//
//  2. IT IS THE CLOSING SPEED THAT HURTS, not either speedometer. Two rigs running the same way at
//     sixty that touch are a scrape; one at sixty meeting one at sixty head-on is not the same
//     event twice over, it is a much worse event once. `closing` is the relative velocity along the
//     line between them, which is the only number that gets both of those right, and it is why a
//     truck you are slowly catching up to can be nudged without a bill.
//
//  3. BOTH TRUCKS PAY, and they do not pay the same. Damage is split by WHICH END met the other
//     one — the same `impactSplit` a wall uses, so nosing into somebody costs you the front and
//     costs them the rear, and the existing per-component model does the rest without learning that
//     a second vehicle exists. There is no fault, no blame, no report to anybody: two trucks hit
//     each other and both of them are worse off, which is what happens.
//
// ⚠ NPC RIGS RIDE THE SAME PATH. An entry in `others` is anything with a position, a heading and a
// speed — a player's rig or a computer's — because the physics of two masses meeting is not a fact
// about who is holding the wheel. When traffic lands it must not get its own collision code.

import { impactSplit, applyDamage } from './damage.js';
import { wearForImpact } from './rig.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer } from '../../server/engine/world.js';

// How close two rigs have to be to be touching, in tiles. A truck is most of a tile long and the
// contact is generous on purpose: the alternative is two rigs visibly overlapping while the server
// insists they have not met, which is worse than an occasional early bang.
export const TOUCH_TILES = 0.62;
// Below this closing speed it is a nudge: a noise, a shove, no damage, no bill. Parking is not a
// crash, and a yard where kissing another truck at walking pace costs credits is a yard nobody
// manoeuvres in.
export const NUDGE_MPH = 7;
// A quiet window per PAIR, so one contact is one event rather than one per telemetry frame while
// two bodies are separating. Keyed on the pair, never on the rig — you can be hit by two different
// trucks in the same second and both of them happened.
const COOLDOWN_MS = 2500;
const recent = new Map();   // "a|b" -> ts
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Which end of MINE met them: the bearing to the other truck, in my own frame. The same three areas
// the wall collision uses, so the damage split is the one that already exists.
function areaOf(rig, other) {
  const bearing = (Math.atan2(other.x - rig.x, -(other.y - rig.y)) * 180 / Math.PI + 360) % 360;
  const rel = ((bearing - (rig.heading || 0) + 540) % 360) - 180;
  return Math.abs(rel) < 60 ? 'front' : Math.abs(rel) > 120 ? 'rear' : 'side';
}

// Closing speed along the line between the two, in mph. Positive means they are coming together.
// This is the whole of point 2 in the header.
export function closingMph(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const nx = dx / d, ny = dy / d;
  const va = a.speed || 0, vb = b.speed || 0;
  const ah = (a.heading || 0) * Math.PI / 180, bh = (b.heading || 0) * Math.PI / 180;
  // Heading 0 = north = −y, 90 = east = +x — the world convention (see flight-model.js).
  const ax = Math.sin(ah) * va, ay = -Math.cos(ah) * va;
  const bx = Math.sin(bh) * vb, by = -Math.cos(bh) * vb;
  return (ax - bx) * nx + (ay - by) * ny;
}

// A rebound, in the same spirit as the wall's: separate the bodies and take the speed out of them,
// so the next frame is not the same collision again. Written straight onto the rig — the client
// picks it up as an authoritative correction on its next push, exactly as it does for a bog.
function shove(rig, awayX, awayY, k) {
  rig.x -= awayX * 0.30 * k;
  rig.y -= awayY * 0.30 * k;
  rig.speed = Math.max(0, Math.abs(rig.speed) * 0.25) * (rig.speed < 0 ? -1 : 1);
  rig.yawRate = 0;
}

// THE ONE ENTRY POINT. `mine` is the rig that just reported; `others` is every other body that
// could be in the same place — player rigs and, when it exists, NPC traffic. Returns the list of
// collisions that actually happened, for the caller to narrate.
export function collideTrucks(mine, others, now = Date.now()) {
  const hits = [];
  if (!mine || mine.leg !== 'city') return hits;    // the corridor is single-file and synthetic
  for (const other of others) {
    if (!other || other === mine) continue;
    if (other.leg && other.leg !== mine.leg) continue;
    if (other.zoneId && mine.zoneId && other.zoneId !== mine.zoneId) continue;
    const d = Math.hypot(other.x - mine.x, other.y - mine.y);
    if (!(d < TOUCH_TILES)) continue;
    // ⚠ TOUCHING IS NOT COLLIDING, and this line is the difference between a system and a nuisance.
    // Two trucks parked nose to tail in a yard are inside TOUCH_TILES of each other permanently —
    // without this they would "nudge" each other every time the cooldown expired, forever, and the
    // log would fill up with a bump that is not happening. A contact requires the two of them to
    // actually be coming TOGETHER.
    const closing = Math.max(0, closingMph(mine, other));
    if (closing < 0.5) continue;
    const key = pairKey(mine.playerId || mine.id, other.playerId || other.id);
    if (now - (recent.get(key) || 0) < COOLDOWN_MS) continue;
    recent.set(key, now);
    // The quiet-window map is swept as it is written rather than on a timer: a pair that has not
    // touched in a minute cannot be in a cooldown, and a Map that only ever grows is a leak with a
    // slow fuse.
    if (recent.size > 64) for (const [k, t] of recent) if (now - t > 60000) recent.delete(k);
    const dx = (other.x - mine.x) / (d || 1e-6), dy = (other.y - mine.y) / (d || 1e-6);
    shove(mine, dx, dy, 1);
    shove(other, -dx, -dy, 1);

    const hit = { other, closing, nudge: closing < NUDGE_MPH };
    if (!hit.nudge) {
      // Speed decides the bill, through the SAME curve a wall uses. A truck is a harder thing to
      // hit than a shopfront, so the total is a shade heavier — but it is one multiplier on an
      // existing curve, not a second damage model with its own opinions.
      const total = wearForImpact(closing) * 1.25;
      applyDamage(mine, impactSplit(total, areaOf(mine, other)));
      applyDamage(other, impactSplit(total, areaOf(other, mine)));
      hit.total = total;
    }
    hits.push(hit);
  }
  return hits;
}

// What each driver is told. Deliberately the same voice for both of them and deliberately without
// fault: nobody is informed that it was the other one's doing, because in a cab you do not get told
// that either. A nudge gets a line and no bill; a real hit gets the sound of one.
export function narrateCollision(rig, hit) {
  const id = rig?.playerId;
  if (!id || !getLivePlayer(id)) return;
  if (hit.nudge) {
    sendToPlayer(id, { type: 'emote', message: 'A dull thump through the frame as the two of you touch. Nothing in it.' });
    return;
  }
  const hard = hit.closing > 34;
  sendToPlayer(id, { type: 'emote', message: hard
    ? `<span class="msg-danger">Sheet metal goes somewhere it was never folded to go. The whole cab jumps, the wheel tries to leave your hands, and for a second the windscreen is full of somebody else's paint.</span>`
    : `<span class="text-amber">A bang, and the shove of something as heavy as you are. You're both going to be looking at that later.</span>` });
}
