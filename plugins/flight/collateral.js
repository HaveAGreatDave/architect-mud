// Crash collateral — what a downed aircraft does to the GROUND it craters into.
// A crash used to only wreck the airframe and kill its occupants; now, if it comes
// down on an inhabited tile, it kills bystanders, runs up a third-party damage bill
// (what liability insurance covers, or the pilot personally owes), and — because
// ditching a plane into a populated area is a crime — charges the pilot with reckless
// endangerment (and manslaughter if it kills anyone). This is the seam that ties
// crashes to the economy and the law. Called from state.crash() before occupants die.
import { getZoneNpcs, getZonePlayers } from '../../server/engine/world.js';
import { killNpcInstance } from '../../server/engine/combat.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';

const CASUALTY_COST = 1200;   // liability credits per bystander killed
const CLEANUP_BASE = 400;     // property/cleanup credits per severity tier (inhabited tiles)

// "Fit to fly?" — the insurer's question. Flying under severe impairment (blackout-drunk,
// or carrying a real active dose of any drug — including a hallucinogen, which lives in
// activeDrugs) voids cover, like drink-driving. A single beer or a faint comedown tail is
// below the bar. Tunable.
const INTOX_SEVERE = 55;            // alcohol meter (0–100): 45 = "drunk" band, 55 = unfit
const DRUG_SEVERE_POTENCY = 0.75;   // an active drug at/above this potency = meaningfully impaired
export function isSeverelyImpaired(player) {
  if (!player) return false;
  if ((player.intoxication || 0) >= INTOX_SEVERE) return true;
  return (player.activeDrugs || []).some(d => (d?.potency ?? 1) >= DRUG_SEVERE_POTENCY);
}

// Bigger airframe → bigger crater. A Leviathan cratering ≫ a Mayfly.
export function crashSeverity(hullHp) {
  if ((hullHp || 0) >= 60) return 3;   // heavy / gunship
  if ((hullHp || 0) >= 25) return 2;   // prop / twin
  return 1;                            // ultralight / light
}

// The third-party bill for a given severity + casualty count on an inhabited tile.
export function collateralBill(severity, casualties, populated) {
  return casualties * CASUALTY_COST + (populated ? severity * CLEANUP_BASE : 0);
}

// Apply a crash's collateral to the surface tile it hit. Returns { bill, casualties }.
// `pilot` (may be null) is the responsible flyer — charged with the crime if there is one.
export async function applyCrashCollateral(live, surface, pilot) {
  if (!surface) return { bill: 0, casualties: 0 };
  const severity = crashSeverity(live.type?.hull_hp);
  const npcs = getZoneNpcs(surface.id) || [];
  // Players standing on the tile it craters into — but never the people ONBOARD
  // (crash() has already moved the pilot's current_zone to the wreck tile, and the
  // occupant death-loop kills them separately). A bigger crater catches more people.
  const occ = new Set(live.occupants);
  const groundPlayers = getZonePlayers(surface.id).filter(p => p && !occ.has(p.id));
  const hitChance = Math.min(0.85, 0.35 * severity);
  // (Was flags?.is_safe_zone — a key that never existed in flags, so this half
  // was always false; the sanctuary tag makes the "civilized tile" check real.)
  const populated = !!surface.flags?.sanctuary || npcs.length > 0 || groundPlayers.length > 0;

  // Kill up to `severity` bystanders caught under the wreck (they respawn on the usual timer).
  let casualties = 0;
  const victims = [];   // names of the dead, echoed back to the pilot's own pane
  for (const n of npcs.slice(0, severity)) { if (killNpcInstance(n.id)) { casualties++; victims.push(n.name); } }
  // Each player on the tile has a severity-scaled chance of being caught under it.
  for (const p of groundPlayers) {
    if (Math.random() >= hitChance) continue;
    sendToPlayer(p.id, { type: 'output', message: '<span class="text-red">The world fills with a screaming shadow — the wreck comes down on top of you. There is a noise, and then there is nothing.</span>' });
    await handlePlayerDeath(p, pilot, { type: 'crash', label: `Crushed by a crashing ${live.type?.name || 'aircraft'}` });
    casualties++; victims.push(p.handle);
  }
  if (casualties > 0) {
    sendToZone(surface.id, { type: 'zone_event', refresh: true,
      message: `<span class="text-red">The wreck ploughs through the tile — ${casualties === 1 ? 'someone is' : casualties + ' people are'} caught in the fireball.</span>` });
    // Tell the pilot who they took with them — it lands in their pane before the crash death.
    if (pilot) sendToPlayer(pilot.id, { type: 'output', message: `<span class="text-red">★ Your wreck killed: ${victims.join(', ')}.</span>` });
  }

  const bill = collateralBill(severity, casualties, populated);

  // Crime: ditching into an inhabited area is reckless endangerment; killing people is
  // manslaughter. Charged to the pilot (they chose to fly there) — persists past their death.
  if (pilot && populated) {
    await dispatchAction({ type: 'CHARGE_CRIME', actor: pilot, params: { key: 'reckless_endangerment' } });
    if (casualties > 0) await dispatchAction({ type: 'CHARGE_CRIME', actor: pilot, params: { key: 'manslaughter' } });
  }
  return { bill, casualties };
}
