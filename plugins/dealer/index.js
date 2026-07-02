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
 *
 * The passphrase is a one-time key: once a player has been introduced, they can
 * just TALK to him to deal again (the `npc.talk` hook below), still gated to his
 * dealing hours. Strangers who haven't learned the words get nothing from talk.
 */
import { getZoneNpcs, world } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { activePassphrase, nextPassphrase } from './rotation.js';

const DEFAULT_PASSPHRASES = [
  "the statics bad tonight",
  "the static is bad tonight",
  "you holding",
  "ask the shadows",
];

const GRAFFITI_CHANCE = 0.5;   // per entry into his haunt, chance the wall gives up the live phrase

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// The rotation pool: his configured phrases, or the built-in fallback.
function poolFor(npc) {
  return Array.isArray(npc.flags?.passphrases) && npc.flags.passphrases.length
    ? npc.flags.passphrases : DEFAULT_PASSPHRASES;
}

// His dealing hours (wraps midnight like the AI's HOUR_RANGE). Defaults to night.
function isDealingHour(npc) {
  const from = npc.flags?.deal_from ?? 21;
  const to = npc.flags?.deal_to ?? 5;
  const { hour } = getEnvironmentState();
  if (hour == null) return true;
  return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
}

// Only the phrase live for the current 2-day window opens the door (rotation.js).
// Yesterday's words get you nothing — you have to know tonight's.
function matchesPassphrase(npc, text) {
  const active = activePassphrase(poolFor(npc));
  if (!active) return false;
  return normalize(text).includes(normalize(active));
}

// The reward for being known: he murmurs the phrase that takes over when this one
// dies, so a regular is never shut out by the rotation. Silent if it isn't rotating.
function nextPhraseMurmur(npc) {
  const pool = poolFor(npc);
  const next = nextPassphrase(pool);
  if (!next || normalize(next) === normalize(activePassphrase(pool))) return '';
  return ` Then, lower still: "Words turn over soon. When these die, it's — «${next}»."`;
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
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">The figure gives an almost imperceptible nod. "Back again. What do you need?"${nextPhraseMurmur(dealer)}</span>` });
  }

  // Reuse the standard vendor path — opens a shop session + sends the panel to
  // this player only. Stock arrives trust-filtered (vendor.js).
  await dispatchAction({ type: 'OPEN_SHOP', actor: player, params: { npcId: dealer.id }, context: { broadcast } });
}

// A returning customer (already met) just talks to him — no passphrase needed.
// Strangers fall through (undefined) to normal talk handling, so the only way in
// the first time is still to say the words.
async function onTalk({ player, npc, broadcast }) {
  if (!player || npc?.npc_type !== 'dealer' || !npc.flags?.covert) return undefined;
  if (!(await getFlag('player', 'dealer_met', player))) return undefined;

  if (!isDealingHour(npc)) {
    return { type: 'output', message: `<span class="msg-system">The figure doesn't so much as glance at you.</span>` };
  }
  await dispatchAction({ type: 'OPEN_SHOP', actor: player, params: { npcId: npc.id }, context: { broadcast } });
  return { type: 'output', message: `<span class="msg-system">The figure gives an almost imperceptible nod. "Back again. What do you need?"${nextPhraseMurmur(npc)}</span>` };
}

// All covert dealers currently in the live world.
function covertDealers() {
  return [...world.npcs.values()].filter(n => n?.npc_type === 'dealer' && n.flags?.covert);
}

// Rotating graffiti — his haunt (home zone, or wherever he's standing) carries a
// freshly-scratched clue spelling out the phrase live for this window, so the
// "read the wall" discovery loop keeps working as the words turn over.
on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !zone) return;
  const dealer = covertDealers().find(n => n.home_zone === zone || n.zone_id === zone);
  if (!dealer) return;
  if (Math.random() > GRAFFITI_CHANCE) return;
  const active = activePassphrase(poolFor(dealer));
  if (!active) return;
  sendToPlayer(actor.id, { type: 'output', message: `<span class="msg-ambient">Scratched into the wall, the grooves still pale and fresh: "${active}."</span>` });
});

// Cross-plugin read (gossip uses this to leak the *live* phrase, not a stale one).
// params.npc → { active, next } for that dealer's current rotation window.
registerAction({
  type: 'dealer.passphrase',
  handler: ({ params }) => {
    const npc = params?.npc;
    if (!npc) return { active: null, next: null };
    const pool = poolFor(npc);
    return { active: activePassphrase(pool), next: nextPassphrase(pool) };
  },
});

export const hooks = {
  'player.say': (payload) => onSay(payload).catch(e => console.error('[dealer] onSay:', e.message)),
  'npc.talk': (payload) => onTalk(payload).catch(e => { console.error('[dealer] onTalk:', e.message); return undefined; }),
};
