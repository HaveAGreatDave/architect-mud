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

const KINDS = [
  {
    id: 'mechanic', weight: 3,
    look: 'a heavy-set woman sitting on a toolbox with her back to the wind',
    line: '"Whatever it is, I can probably get you to the other end. That is all I ever promise."',
    // Worth money in the sense that mattered: she is the difference between a breakdown and a haul.
  },
  {
    id: 'local', weight: 3,
    look: 'a wiry man in a coat two sizes too big, watching the road rather than you',
    line: '"You are going the long way. Everybody does. I will show you where it stops being the long way."',
  },
  {
    id: 'chancer', weight: 2,
    look: 'somebody young, with clean boots and a bag they keep between their feet',
    line: '"I have money. Not a lot. Enough that you would rather have it than not."',
  },
  {
    id: 'fugitive', weight: 2,
    look: 'a thin figure who does not step out until you have already slowed, and who does not look at the road behind them',
    line: '"I am not going to lie to you about what this is. I am going to ask anyway."',
  },
];
const TOTAL = KINDS.reduce((n, k) => n + k.weight, 0);

// Deterministic 32-bit hash — the same one shape the corridor and voidwalking use, for the same
// reason: everyone driving this stretch this week meets the same person.
function seed(route, node) {
  let h = 2166136261;
  const s = `${route?.key || 'road'}:${route?.window || 0}:${node}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

// About one node in three has somebody on it. Node 0 never does — you have not left yet — and nor
// does the last, because a figure on the shoulder within sight of the far town is somebody who
// could have walked.
export function hitcherAt(route, node, nodes) {
  if (node <= 0 || node >= nodes - 1) return null;
  const r = seed(route, node);
  if (r > 0.34) return null;
  let pick = ((r * 1000) % 1) * TOTAL, kind = KINDS[0];
  for (const k of KINDS) { if (pick < k.weight) { kind = k; break; } pick -= k.weight; }
  return { ...kind, node };
}

export const HITCHER_KINDS = KINDS;
