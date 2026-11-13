// How much an NPC at home has had to drink, 0 (sober) to 3 (very drunk). RAM only, on the NPC.
//
// Two sources. A drink they're seen having at home (a toast, a bottle out of the fridge, a home-life booze
// scene) adds one with drinkUp(), and each fades over DRINK_MS. A dose npc-drugs gave them (`_ai.dose`) counts
// too: a sedative (drink is one) adds by its dose count, a belligerent drunk goes straight to 3.
//
// Read by home-talk.js (a drunk pair starts hotter and gets the drunk topics) and plugins/roomstage
// npc-life.js (which shared activities they're up for, and arguments more often).

const DRINK_MS = 45 * 60_000;

export function drinkUp(npc, n = 1) {
  if (!npc) return;
  const now = Date.now(), had = (npc._drinks || []).filter((t) => now - t < DRINK_MS);
  for (let i = 0; i < n; i++) had.push(now);
  npc._drinks = had.slice(-8);
}

export function tipsyOf(npc, now = Date.now()) {
  if (!npc) return 0;
  const home = (npc._drinks || []).filter((t) => now - t < DRINK_MS).length;
  const d = npc._ai?.dose && (npc._ai.dose.until ?? Infinity) > now ? npc._ai.dose : null;
  const dosed = !d ? 0 : d.belligerent ? 3 : d.kind === 'sedated' || d.loose ? Math.min(3, d.doses || 1) : 0;
  return Math.min(3, Math.max(dosed, home >= 5 ? 3 : home >= 3 ? 2 : home >= 1 ? 1 : 0));
}
