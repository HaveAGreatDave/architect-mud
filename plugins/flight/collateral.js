// Crash collateral — what a downed aircraft does to the GROUND it craters into.
// A crash used to only wreck the airframe and kill its occupants; now, if it comes
// down on an inhabited tile, it kills bystanders, runs up a third-party damage bill
// (what liability insurance covers, or the pilot personally owes), and — because
// ditching a plane into a populated area is a crime — charges the pilot with reckless
// endangerment (and manslaughter if it kills anyone). This is the seam that ties
// crashes to the economy and the law. Called from state.crash() before occupants die.
import { getZoneNpcs } from '../../server/engine/world.js';
import { killNpcInstance } from '../../server/engine/combat.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { sendToZone } from '../../server/engine/messaging.js';

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
  // (Was flags?.is_safe_zone — a key that never existed in flags, so this half
  // was always false; the sanctuary tag makes the "civilized tile" check real.)
  const populated = !!surface.flags?.sanctuary || npcs.length > 0;

  // Kill up to `severity` bystanders caught under the wreck (they respawn on the usual timer).
  let casualties = 0;
  for (const n of npcs.slice(0, severity)) { if (killNpcInstance(n.id)) casualties++; }
  if (casualties > 0) {
    sendToZone(surface.id, { type: 'zone_event', refresh: true,
      message: `<span class="text-red">The wreck ploughs through the tile — ${casualties === 1 ? 'a bystander is' : casualties + ' bystanders are'} caught in the fireball.</span>` });
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
