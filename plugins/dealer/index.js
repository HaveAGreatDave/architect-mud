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

// First-contact is per-dealer: meeting Keller doesn't introduce you to Marsh.
// Keyed on the NPC id so each dealer gates independently (there are three now).
function metFlag(npc) {
  return `${npc.id}_met`;
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

// ── Trust & wrong-passphrase penalty ──────────────────────────────────────────
// Try the WRONG words on a dealer and he sours: trust drops, and once it goes
// negative he won't deal at all. It keeps dropping if you keep fumbling, floored
// so it can't spiral forever, and rebounds on its own back to 0 (where he'll deal
// again). The rebound only heals the *negative* part — botching does not restore
// standing you'd genuinely earned, it just wipes down to a cold zero.
const WRONG_PENALTY = 20;      // trust lost per wrong passphrase
const TRUST_FLOOR = -60;       // how low a sour streak can push it
const RECOVER_PER_MIN = 10;    // negative trust healed back toward 0, per real minute

// Pure: heal a negative balance toward 0 by elapsed minutes since the last
// offence. Positive (earned) trust is never touched. Exported for regress.
export function recoverTrust(stored, negTs, now, perMin = RECOVER_PER_MIN) {
  if (stored >= 0 || !negTs) return stored;
  const minutes = (now - negTs) / 60000;
  return Math.min(0, stored + Math.floor(minutes * perMin));
}
// Pure: one wrong-passphrase hit, clamped at the floor. Exported for regress.
export function penalize(current, penalty = WRONG_PENALTY, floor = TRUST_FLOOR) {
  return Math.max(floor, current - penalty);
}

function negTsFlag(npc) { return `${npc.flags?.trust_flag || 'dealer_trust'}_negts`; }

// Read the player's trust with this dealer, lazily healing any negative balance
// toward 0 and persisting it so vendor.js tiering sees the recovered value.
async function readTrust(npc, player) {
  const flag = npc.flags?.trust_flag || 'dealer_trust';
  let trust = Number(await getFlag('player', flag, player)) || 0;
  if (trust < 0) {
    const ts = Number(await getFlag('player', negTsFlag(npc), player)) || 0;
    const healed = recoverTrust(trust, ts, Date.now());
    if (healed !== trust) {
      await setFlag('player', flag, String(healed), player);
      if (healed === 0) await setFlag('player', negTsFlag(npc), '0', player);
      trust = healed;
    }
  }
  return trust;
}

// Apply a wrong-passphrase penalty (after healing pending recovery first), and
// restart the rebound clock from now.
async function penalizeTrust(npc, player) {
  const flag = npc.flags?.trust_flag || 'dealer_trust';
  const next = penalize(await readTrust(npc, player));
  await setFlag('player', flag, String(next), player);
  await setFlag('player', negTsFlag(npc), String(Date.now()), player);
  return next;
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

  // Wrong words. If it's a real passphrase — this dealer's stale one, or another
  // crew's — said in his hearing during dealing hours, he takes it badly. Trust
  // drops; once negative, no deal until it rebounds. Random chatter that matches
  // no known phrase is just ignored (he never heard a thing).
  if (!matchesPassphrase(dealer, text)) {
    if (isDealingHour(dealer) && looksLikePassphrase(text)) {
      const trust = await penalizeTrust(dealer, player);
      const msg = trust < 0
        ? `The wrong words. His face shuts like a door. "...No. Not that, not from you, not tonight." You've soured something you hadn't even earned yet — leave it a while.`
        : `The wrong words. Something cold crosses his face. "...That's not it. Careful who you try that on." He doesn't move to help you.`;
      sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${msg}</span>` });
    }
    return;
  }

  if (!isDealingHour(dealer)) {
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">The figure doesn't so much as glance at you.</span>` });
    return;
  }

  // Right words — but a soured customer gets the cold shoulder until the rebound
  // brings them back to zero.
  if ((await readTrust(dealer, player)) < 0) {
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">He looks through you like glass. Whatever you pulled last time hasn't worn off. Not yet.</span>` });
    return;
  }

  const trustFlag = dealer.flags?.trust_flag || 'dealer_trust';
  const met = await getFlag('player', metFlag(dealer), player);
  if (!met) {
    await setFlag('player', metFlag(dealer), 'true', player);
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
  if (!(await getFlag('player', metFlag(npc), player))) return undefined;

  if (!isDealingHour(npc)) {
    return { type: 'output', message: `<span class="msg-system">The figure doesn't so much as glance at you.</span>` };
  }
  if ((await readTrust(npc, player)) < 0) {
    return { type: 'output', message: `<span class="msg-system">He looks through you like glass. Whatever you pulled last time hasn't worn off. Not yet.</span>` };
  }
  await dispatchAction({ type: 'OPEN_SHOP', actor: player, params: { npcId: npc.id }, context: { broadcast } });
  return { type: 'output', message: `<span class="msg-system">The figure gives an almost imperceptible nod. "Back again. What do you need?"${nextPhraseMurmur(npc)}</span>` };
}

// All covert dealers currently in the live world.
function covertDealers() {
  return [...world.npcs.values()].filter(n => n?.npc_type === 'dealer' && n.flags?.covert);
}

// Does the text contain any known dealer passphrase (any crew, active or stale)?
// Used to tell a genuine wrong-passphrase attempt from innocent chatter, so only
// the former burns trust. A wild made-up guess that matches nothing is ignored.
function looksLikePassphrase(text) {
  const t = normalize(text);
  if (!t) return false;
  for (const d of covertDealers()) {
    for (const p of poolFor(d)) {
      const n = normalize(p);
      if (n && t.includes(n)) return true;
    }
  }
  return false;
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
