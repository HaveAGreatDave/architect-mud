// Street cred: a hidden standing with the black market as a whole. See docs/proposals/street-dealers.md.
//
// A black-market contact is any NPC with a `flags.street` block and a `flags.trust_flag`. This plugin:
//   - raises cred when your trust with a contact crosses a step (on `vendor.purchase`, after vendor.js has
//     already written the new trust)
//   - seeds a new contact's trust from your cred the first time you're in their room, discounted by their
//     `wary`, so a name on the street opens doors you haven't knocked on
//   - has the contact react when you come into their room, by how they see you (own trust plus cred)
//   - at a contact's trust cap, vouches you to the contacts in `vouches_to`: you're introduced, so a
//     passphrase dealer (plugins/dealer) will talk to you without the words
//
// ⚠ NEVER SHOWN. Nothing here prints cred, a tier or a change in it. A player notices cred only in how
// these people treat them.
//
// Reads are from the hydrated `player._flags` cache (flags.js), so `zone.entered` adds no round trip
// unless a write is due: a first meeting's seed, once per contact per player.
import { on } from '../../server/engine/events.js';
import { getNpc, getZoneNpcs, getLivePlayer } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { isNpcAsleep } from '../../server/engine/ai-behaviour.js';
import {
  CRED_MAX, decayCred, trustStep, credForSteps, addCred, standing, seedTrust, band,
} from './cred.js';
// ⚠ GLASS: `npc.streetPose` and `npc.streetRegard` (below) put a contact on their spot and decide stare or nod.

const CRED_FLAG = 'street_cred';
const CRED_AT_FLAG = 'street_cred_at';
const REMARK_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_PER_STEP = 5;

const lastRemark = new Map();   // `${playerId}:${npcId}` -> ms

export function isContact(npc) {
  return !!(npc?.flags?.street && npc.flags.trust_flag);
}

export async function readCred(player, now = Date.now()) {
  const stored = await getFlag('player', CRED_FLAG, player);
  const at = Number(await getFlag('player', CRED_AT_FLAG, player)) || 0;
  return decayCred(stored, at, now);
}

async function writeCred(player, value, now = Date.now()) {
  await setFlag('player', CRED_FLAG, String(Math.round(value * 100) / 100), player);
  await setFlag('player', CRED_AT_FLAG, String(now), player);
}

export async function gainCred(player, gain) {
  if (!gain) return;
  const now = Date.now();
  await writeCred(player, addCred(await readCred(player, now), gain), now);
}

async function readTrust(npc, player) {
  const raw = await getFlag('player', npc.flags.trust_flag, player);
  return raw === undefined || raw === null ? null : Number(raw) || 0;
}

// First time a contact sees you: start their trust from what they've heard about you.
async function seedContact(npc, player) {
  if ((await readTrust(npc, player)) !== null) return;
  const seed = seedTrust(await readCred(player), npc.flags.street.wary);
  await setFlag('player', npc.flags.trust_flag, String(seed), player);
}

// Introduce the player to each contact this one vouches for.
async function vouch(npc, player) {
  const targets = npc.flags.street.vouches_to;
  if (!Array.isArray(targets) || !targets.length) return false;
  const doneFlag = `${npc.id}_vouched`;
  if (await getFlag('player', doneFlag, player)) return false;
  await setFlag('player', doneFlag, 'true', player);
  const cred = await readCred(player);
  for (const id of targets) {
    const target = getNpc(id);
    await setFlag('player', `${id}_met`, 'true', player);      // plugins/dealer's introduction flag
    if (target?.flags?.trust_flag && (await getFlag('player', target.flags.trust_flag, player)) === undefined) {
      // A vouch is worth more than hearsay: the target counts your cred as if they weren't wary at all.
      await setFlag('player', target.flags.trust_flag, String(seedTrust(cred, 0)), player);
    }
  }
  return true;
}

export async function onPurchase({ player: who, npcId }) {
  const npc = getNpc(npcId);
  if (!isContact(npc) || !who?.id) return;
  const player = getLivePlayer(who.id);
  if (!player) return;

  const trust = (await readTrust(npc, player)) ?? 0;
  const stepFlag = `${npc.flags.trust_flag}_credstep`;
  const paid = Number(await getFlag('player', stepFlag, player)) || 0;
  const step = trustStep(trust);
  if (step > paid) {
    await setFlag('player', stepFlag, String(step), player);
    await gainCred(player, credForSteps(paid, step, npc.flags.street.cred_per_step ?? DEFAULT_PER_STEP));
  }

  if (trust >= (npc.flags.trust_max ?? 100) && (await vouch(npc, player)) && npc.flags.street.vouch_line) {
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${npc.flags.street.vouch_line}</span>` });
  }
}

function pick(list) {
  return Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export async function onEntered({ actor, zone }) {
  if (!actor?.id || !zone) return;
  const contacts = (getZoneNpcs(zone) || []).filter(n => isContact(n) && !isNpcAsleep(n));
  if (!contacts.length) return;
  const player = getLivePlayer(actor.id) || actor;
  const now = Date.now();
  const cred = await readCred(player, now);
  for (const npc of contacts) {
    await seedContact(npc, player);
    const key = `${player.id}:${npc.id}`;
    if (now - (lastRemark.get(key) || 0) < REMARK_COOLDOWN_MS) continue;
    const seen = standing(await readTrust(npc, player), cred, npc.flags.street.wary);
    const line = pick(npc.flags.street.lines?.[band(seen)]);
    if (!line) continue;
    lastRemark.set(key, now);
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-ambient">${line.replaceAll('{name}', npc.name)}</span>` });
  }
}

// ── In GLASS: the spot, and how they take you ──────────────────────────────────────────────────────────
// A contact with `flags.street.post` minds a spot while they're at work: street life holds them there, leaning on
// the wall if there is one, with the dealer's clips up close (glass/street-life.js, actor3d.js dealerLean/Stand).
export function streetPose(npc) {
  const post = npc?.flags?.street?.post;
  if (!post || !isContact(npc) || !npc.work_zone_id || npc.zone_id !== npc.work_zone_id) return undefined;
  return { k: 'post', f: post.f || null, a: Number(post.a) || 0 };
}
// How they regard one viewer, from that viewer's hydrated flags (sync: no query on the street feed). A stranger gets
// stared at the whole time they're near; somebody trusted gets a nod; in between, the ordinary noticing.
export function regardOf(npc, viewer, now = Date.now()) {
  const F = viewer?._flags;
  if (!isContact(npc) || !(F instanceof Map)) return undefined;
  const cred = decayCred(F.get(CRED_FLAG), Number(F.get(CRED_AT_FLAG)) || 0, now);
  const b = band(standing(Number(F.get(npc.flags.trust_flag)) || 0, cred, npc.flags.street.wary));
  return b === 'stranger' ? 'stare' : b === 'trusted' ? 'nod' : undefined;
}

export const hooks = {
  'npc.streetPose': (npc) => streetPose(npc),
  'npc.streetRegard': ({ npc, viewer }) => regardOf(npc, viewer),
};

on('vendor.purchase', (p) => { onPurchase(p).catch(e => console.error('[streetcred] purchase:', e.message)); });
on('zone.entered', (p) => { onEntered(p).catch(e => console.error('[streetcred] entered:', e.message)); });
on('player.logout', ({ id }) => {
  if (!id) return;
  for (const k of lastRemark.keys()) if (k.startsWith(`${id}:`)) lastRemark.delete(k);
});

export { CRED_MAX };
