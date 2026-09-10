// THE LONG HAUL — people on the shoulder.
//
// Phase 3. A figure standing at the edge of the road with a hand out, seeded per corridor node so
// the same stretch has the same person on it for everyone this week — exactly as the road itself,
// the roadside buildings and the void's own encounters are seeded. Nothing here is random at the
// moment you meet it; it was decided when the week started.
//
// WHY THESE ARE NOT `escort`'s NPCs. `plugins/escort/` moves a REAL NPC out of the world and makes
// them follow you, and it answers flight's `aircraft.companions` gather-hook to get them into a
// cockpit. That is the right machinery for somebody you were asked to deliver. It is the wrong
// machinery for a stranger on a road that does not exist until you drive down it: a corridor node
// is a transient room, and putting a persistent NPC row in one would mean an NPC whose home is
// deleted when the crossing ends. So a hitcher is a seeded FACT about a stretch of road, and the
// only thing that persists is what they did to you.
//
// THE RULE THAT MAKES IT A SYSTEM RATHER THAN A SLOT MACHINE: every one of them is worth stopping
// for and every one of them can cost you, and you cannot tell which is which from the roadside.
// What you CAN read is what they are carrying, how they stand, and what they say when they get in —
// so the information is there and it is never a label.
//
// AND THE ONE THAT CLOSES THE DESIGN: a fugitive is contraband with legs. Riding in the sleeper
// they are fast and free and anyone who looks in the cab finds them. Riding in the TRAILER they are
// invisible to a look and they are EIGHTY KILOS THE WEIGHBRIDGE CAN SEE. That is the whole scale
// house pointed at a person, and it is a decision you make a mile before the plates.

import { nodeAt, sOfNode, roomLenOf } from './corridor.js';

const KINDS = [
  {
    id: 'mechanic', weight: 3,
    look: 'a heavy-set woman sitting on a toolbox with her back to the wind',
    line: '"Whatever it is, I can probably get you to the other end. That\'s all I ever promise."',
    // Worth money in the sense that mattered: she is the difference between a breakdown and a haul.
  },
  {
    id: 'local', weight: 3,
    look: 'a wiry man in a coat two sizes too big, watching the road rather than you',
    line: '"You\'re going the long way. Everybody does. I will show you where it stops being the long way."',
  },
  {
    id: 'chancer', weight: 2,
    look: 'somebody young, with clean boots and a bag they keep between their feet',
    line: '"I have money. Not a lot. Enough that you would rather have it than not."',
  },
  {
    id: 'fugitive', weight: 2,
    look: "a thin figure who doesn't step out until you have already slowed, and who doesn't look at the road behind them",
    line: '"I\'m not going to lie to you about what this is. I\'m going to ask anyway."',
  },
];
const TOTAL = KINDS.reduce((n, k) => n + k.weight, 0);

// ── ⚠ TWO BUGS LIVED IN THIS FUNCTION, AND BETWEEN THEM THEY TURNED THE FEATURE OFF ──────────
//
// It read `route?.key`, and a route has no `key`. It has `voidKey`, `destKey` and `seedKey` (see
// corridorFor), so every road in the game hashed the literal string 'road' and the only thing left
// varying was the window and the node — which is to say every corridor out of every region met the
// same people on the same numbered stretch in the same week.
//
// And it was raw FNV-1a, taken straight as a fraction. FNV's avalanche on a string whose only
// variation is the last character or two is poor, and the eight nodes of a week differ by exactly
// that — so a week's values came out clustered inside a band of about 0.03. Against a threshold of
// 0.34 that is not a one-in-three chance per stretch, it is a one-in-three chance PER WEEK that the
// whole road is lined with them, and otherwise nobody at all on the entire crossing. Sampled over
// three consecutive windows, twenty-four eligible stretches produced zero hitchers.
//
// The fix is to stop hand-rolling it. The corridor already owns the pair this file was imitating —
// FNV to seed, mulberry32 to draw — and mulberry32 is the half that does the avalanching. Same two
// functions, spelled the same way, so the road and the people on it are seeded by one idiom.
//
// ⚠ THIS CHANGES WHO IS ON EVERY EXISTING STRETCH. That is intended and it is unavoidable: the old
// numbers were the bug. Nothing persists a hitcher (they are derived at read, which is the whole
// design), so there is nothing to migrate — a road simply has the people on it that it should have
// had all along.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// WHICH ROAD THIS IS. The same identity `segSeed` uses inside the corridor: an explicitly seeded
// route says so, and anything else is the pair of endpoints it runs between.
const roadKey = (route) => route?.seedKey || `${route?.voidKey || 'void'}|${route?.destKey || 'road'}`;
function seed(route, node) {
  return mulberry32(hashSeed(`${roadKey(route)}|${route?.window || 0}|hitch|${node}`))();
}

// ── HOW OFTEN ────────────────────────────────────────────────────────────────
// About one node in five has somebody on it. Node 0 never does — you have not left yet — and nor
// does the last, because a figure on the shoulder within sight of the far town is somebody who
// could have walked.
//
// ⚠ IT WAS 0.34, AND A THIRD OF STRETCHES IS NOT A RARE EVENT — it is a queue. On a crossing with
// six eligible nodes that is two people a haul, every haul, which turns the one thing out here that
// is meant to make you lift off the throttle into a scheduled stop. At 0.18 a full crossing meets
// about one person and a short one often meets nobody, which is the shape the fiction wants: a
// figure on the shoulder is worth slowing for BECAUSE the road is usually empty.
//
// ⚠ AND THE RATE IS THE ONLY DIAL — do not shorten the warning to compensate. Rarity and lead time
// answer two different complaints (how often does this happen, versus can I do anything about it
// when it does), and trading one against the other gets you back to a road you cannot react to,
// only less often.
const PRESENCE = 0.18;

export function hitcherAt(route, node, nodes) {
  if (node <= 0 || node >= nodes - 1) return null;
  const r = seed(route, node);
  if (r > PRESENCE) return null;
  // ⚠ A SECOND DRAW, NOT A RESLICE OF THE FIRST. This was `(r * 1000) % 1`, which is the same
  // number the presence gate just used, shifted three decimal places — so WHICH kind you met was a
  // function of HOW NARROWLY they showed up at all, and the two were correlated for as long as the
  // hash was. It is its own stream now, off the same seeded generator.
  let pick = mulberry32(hashSeed(`${roadKey(route)}|${route?.window || 0}|kind|${node}`))() * TOTAL, kind = KINDS[0];
  for (const k of KINDS) { if (pick < k.weight) { kind = k; break; } pick -= k.weight; }
  return { ...kind, node };
}

// ── WHERE THEY ARE STANDING ──────────────────────────────────────────────────
// ONE DERIVATION, and it was two. `cabContext` worked this out inline so the cab could draw the
// figure, and the warning below needs the identical number for a different reason — a call that
// says "two miles" about somebody the renderer is putting somewhere else is worse than no call at
// all. Half a room along the node they belong to; the lateral offset stays with the caller, because
// the cab wants a verge to stand on and a distance does not care.
export function hitcherSOf(route, node) {
  return sOfNode(route, node) + roomLenOf(route) * 0.5;
}

// The nearest hitcher within `within` tiles, or null. Used by the warning — see `passHitcher`.
//
// ⚠ IT SCANS THE NEIGHBOURING NODES, and that is the point of it rather than an optimisation. A
// hitcher stands half a room in, so by the time their own node is under your wheels they are
// already only fifteen miles off and closing: a warning that cannot look across the boundary can
// never be earlier than that, whatever distance you write into it.
//
// ⚠ AND THE RANGE IS UNSIGNED, exactly as `signsBetween` is. `s` runs back down as well as up (see
// `retreat`), and a driver coming back at somebody is approaching them just the same. Which side of
// them you are on is a fact about the driver, not about the road.
export function hitcherAhead(route, s, nodes, within) {
  const here = nodeAt(route, s, nodes);
  let best = null;
  for (let n = here - 1; n <= here + 1; n++) {
    const who = hitcherAt(route, n, nodes);
    if (!who) continue;
    const hs = hitcherSOf(route, n);
    const d = Math.abs(hs - s);
    if (d > within) continue;
    if (!best || d < best.tiles) best = { ...who, s: hs, tiles: d };
  }
  return best;
}

export const HITCHER_KINDS = KINDS;
