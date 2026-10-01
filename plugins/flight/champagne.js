// ── THE DRAKE'S CHAMPAGNE ─────────────────────────────────────────────────────
// An ice bucket at the aft end of the cockpit with a bottle in it. Anyone aboard can drink a glass,
// or pour one for everybody else aboard. The pumps refill it: every refuel tops it back up to a
// full bottle. The count lives on the aircraft row (`custom_data.champagne`), so it survives a
// landing and a reboot; a Drake that has never been opened has a full bottle.
// The glass is real drink: `useDrug(drug_alcohol)` on the drink route, the same call a bottled
// cocktail makes (plugins/drinks), so intoxication, tolerance and phases all apply.
import { useDrug } from '../../server/engine/drugs.js';
import { liveAircraft, persist, getLivePlayer, sendToPlayer } from './state.js';

export const CHAMPAGNE_FULL = 6;           // glasses in a bottle
const GLASS_POTENCY = 0.6;                  // a flute, not a cocktail

export const glassesOf = (customData) => {
  const n = customData?.champagne;
  return Number.isFinite(n) ? Math.max(0, Math.min(CHAMPAGNE_FULL, n)) : CHAMPAGNE_FULL;
};
// Tops the bottle up on a refuel. Mutates and returns custom_data; true when it changed.
export function refillChampagne(customData) {
  if (glassesOf(customData) === CHAMPAGNE_FULL && customData?.champagne === CHAMPAGNE_FULL) return false;
  customData.champagne = CHAMPAGNE_FULL;
  return true;
}
// The cockpit draws the bottle from this; sent to everyone aboard whenever the count moves.
export function pushChampagne(live) {
  if (live?.type?.class !== 'drake') return;
  const n = glassesOf(live.row.custom_data);
  for (const pid of live.occupants) sendToPlayer(pid, { type: 'drake_champagne', n });
}

const nameOf = (p) => p?.name || 'Someone';

async function drinkGlass(p, broadcast) {
  const res = await useDrug(p, 'drug_alcohol', broadcast, { potencyMult: GLASS_POTENCY, skipInstant: true, route: 'drink' });
  return res?.message || '';
}

// `champagne` / `champagne drink`: a glass for you. `champagne pour`: a glass for everyone else aboard.
export async function cmdChampagne(args, raw, player, broadcast) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || live.type?.class !== 'drake') return { type: 'error', message: "There's no champagne here." };
  const cd = (live.row.custom_data ||= {});
  let n = glassesOf(cd);
  const sub = (args[0] || 'drink').toLowerCase();
  if (sub === 'look' || sub === 'check') return { type: 'output', message: n ? `The bottle in the ice bucket has ${n} glass${n === 1 ? '' : 'es'} left in it.` : 'The ice bucket holds nothing but ice. The pumps will see to it next refuel.' };
  if (!n) return { type: 'output', message: 'The bottle is empty. It gets topped up when you refuel.' };

  if (sub === 'pour' || sub === 'share' || sub === 'pass' || sub === 'send') {
    const others = [...live.occupants].filter((pid) => pid !== player.id).map(getLivePlayer).filter(Boolean);
    if (!others.length) return { type: 'output', message: "There's nobody else aboard to pour for. Drink it yourself." };
    const served = others.slice(0, n);
    for (const p of served) {
      const fx = await drinkGlass(p, broadcast);
      sendToPlayer(p.id, { type: 'output', message: `${nameOf(player)} pours you a flute of champagne from the ice bucket. You drink it. ${fx}`.trim() });
    }
    cd.champagne = n - served.length;
    await persist(live);
    pushChampagne(live);
    const short = others.length > served.length ? ` The bottle ran dry before ${others.length - served.length} of them got any.` : '';
    return { type: 'output', message: `You pour ${served.length === 1 ? 'a glass' : served.length + ' glasses'} for ${served.map(nameOf).join(', ')}.${short}` };
  }

  cd.champagne = n - 1;
  await persist(live);
  pushChampagne(live);
  const fx = await drinkGlass(player, broadcast);
  for (const pid of live.occupants) if (pid !== player.id) sendToPlayer(pid, { type: 'output', message: `${nameOf(player)} pours a flute of champagne from the ice bucket and drinks it.` });
  const left = cd.champagne ? `${cd.champagne} left in the bottle.` : "That's the last of the bottle.";
  return { type: 'output', message: `You pour a flute of champagne from the ice bucket and drink it. ${left} ${fx}`.trim() };
}
