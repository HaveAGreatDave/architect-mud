/**
 * Being warmed by a THING — a hot drink, a hand warmer, anything you consume or hold that
 * takes the edge off for a while. The counterpart to `insulation` (what you wear) and the
 * heat-source seam in environment.js (what the room contains).
 *
 * WHY IT IS COLD-SIDE ONLY. A mug of cocoa carries something like 40 kcal of heat, which
 * against 70kg of body is thermally nothing — you could drink it in a heatwave and not
 * measurably warm up. What a hot drink actually does is peripheral vasodilation and the part
 * that isn't physiology at all, and both of those are *defences against cold* rather than
 * calories added to a system. So it is modelled as a bonus on the cooling side and is
 * deliberately absent from the heating side: adding it there would be modelling caloric heat
 * that isn't really in the cup.
 *
 * Counted in GAME-minutes and decremented by the body-temp drift, so a hot drink lasts the
 * same subjective time at any game-speed setting. RAM-only, like `_submerged` and `_sweat` —
 * a warmth that survived a relog would be state pretending to matter.
 */

// Fades linearly to nothing rather than expiring off a cliff, because a drink going cold in
// your hands is a gradual disappointment and the numbers should say so.
export function applyWarmth(player, degrees, minutes) {
  if (!player || !(degrees > 0) || !(minutes > 0)) return;
  // A second drink refreshes rather than stacks: the strongest source wins and resets the
  // clock. Otherwise the optimal play in a blizzard is to carry six mugs.
  if ((player._warmC || 0) > degrees && (player._warmMin || 0) > 0) {
    player._warmMin = Math.max(player._warmMin, minutes);
    player._warmFullMin = Math.max(player._warmFullMin || 0, player._warmMin);
    return;
  }
  player._warmC = degrees;
  player._warmMin = minutes;
  player._warmFullMin = minutes;
}

// °C of warmth currently in effect, tapering across the remaining window.
export function warmthBonus(player) {
  const left = player?._warmMin || 0;
  if (left <= 0 || !(player?._warmC > 0)) return 0;
  const full = player._warmFullMin || left;
  return player._warmC * Math.max(0, Math.min(1, left / full));
}

// Burn down the window. Called once from the body-temp drift so there is exactly one clock.
export function tickWarmth(player, gm) {
  if (!(player?._warmMin > 0)) return;
  player._warmMin -= gm;
  if (player._warmMin <= 0) {
    delete player._warmMin; delete player._warmC; delete player._warmFullMin;
  }
}
