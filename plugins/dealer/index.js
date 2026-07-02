/**
 * Dealer plugin — the covert shadow drug-dealer's access mechanic.
 *
 * He never advertises a shop (see the `covert` suppression in social.js). The
 * ONLY way to deal with him is to SAY the right words while he's in your zone.
 * This hooks the engine's `player.say` (fired from cmdSay): if a covert dealer
 * NPC is present and it's his dealing hours, a matching passphrase silently
 * opens his shop (reusing the standard OPEN_SHOP vendor path). Stock is
 * trust-gated in vendor.js — cheap product first, the heavy stuff earned.
 *
 * First contact sets `dealer_met` + seeds `dealer_trust=0` (the first-contact
 * gate: you can't buy until you've discovered how to ask). Everything else
 * (tiers, high-trust payoff) lives as data on the NPC's flags + vendor_inventory.
 */
import { getZoneNpcs } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

const DEFAULT_PASSPHRASES = [
  "the statics bad tonight",
  "the static is bad tonight",
  "you holding",
  "ask the shadows",
];

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// His dealing hours (wraps midnight like the AI's HOUR_RANGE). Defaults to night.
function isDealingHour(npc) {
  const from = npc.flags?.deal_from ?? 21;
  const to = npc.flags?.deal_to ?? 5;
  const { hour } = getEnvironmentState();
  if (hour == null) return true;
  return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
}

function matchesPassphrase(npc, text) {
  const raw = Array.isArray(npc.flags?.passphrases) && npc.flags.passphrases.length
    ? npc.flags.passphrases : DEFAULT_PASSPHRASES;
  const phrases = raw.map(normalize).filter(Boolean);
  const n = normalize(text);
  return phrases.some(p => n.includes(p));
}

async function onSay({ player, text, zoneId, broadcast }) {
  if (!player || !text) return;
  const dealer = (getZoneNpcs(zoneId) || []).find(n => n.npc_type === 'dealer' && n.flags?.covert);
  if (!dealer) return;                       // no dealer here — stay silent
  if (!matchesPassphrase(dealer, text)) return;

  if (!isDealingHour(dealer)) {
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">The figure doesn't so much as glance at you.</span>` });
    return;
  }

  const trustFlag = dealer.flags?.trust_flag || 'dealer_trust';
  const met = await getFlag('player', 'dealer_met', player);
  if (!met) {
    await setFlag('player', 'dealer_met', 'true', player);
    if ((await getFlag('player', trustFlag, player)) === undefined) {
      await setFlag('player', trustFlag, '0', player);
    }
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">The figure's eyes flick to you, then away. A voice, barely there: "...You know the words. Alright. Let's see what you're after. Keep it quiet."</span>` });
  } else {
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">The figure gives an almost imperceptible nod. "Back again. What do you need?"</span>` });
  }

  // Reuse the standard vendor path — opens a shop session + sends the panel to
  // this player only. Stock arrives trust-filtered (vendor.js).
  await dispatchAction({ type: 'OPEN_SHOP', actor: player, params: { npcId: dealer.id }, context: { broadcast } });
}

export const hooks = {
  'player.say': (payload) => onSay(payload).catch(e => console.error('[dealer] onSay:', e.message)),
};
