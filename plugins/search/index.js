// plugins/search — the `search` verb.
//
// WHY THIS IS ITS OWN PLUGIN, AND WHY IT IS ALMOST EMPTY
//
// `search` is a verb several unrelated systems want a piece of: a stray that
// doesn't want finding, a panel seam that isn't a seam, whatever comes next. If
// any one of those owned the verb, the other two would have to reach into it.
// So the verb lives alone and knows only two things — how to roll, and how to
// fail. What can be FOUND is contributed entirely from outside. This file will
// never mention a cat.
//
// THE SEAM IS A GATHER HOOK, NOT AN EXPORTED REGISTRY. An exported
// registerSearchProvider() would make every findable thing `import` this plugin,
// which is the plugin-imports-plugin coupling the engine/plugin boundary doc
// exists to prevent (and would need an `after:` on every consumer to avoid a
// registration race). `search.provider` is the same shape the game already uses
// for workspace.provider, zone.smells and tech.targets: a contributor declares
// the hook in its own manifest, exports a handler, and imports nothing.
//
// NOT A POSTURE. plugins/scavenging owns the perpetual, posture-based hunt
// (`scavenge` + registerActivity) — you settle in and work a room over minutes.
// `search` is one deliberate look, right now, and then it's done. Two verbs, two
// shapes. If you find yourself adding a tick here, you are rebuilding scavenging.
//
// SEARCH NEVER PAYS OUT. Scavenging is the loot verb and this one deliberately
// is not: a 30-second cooldown is per-zone, and a player standing on a district
// grid can step one tile and search again forever. Any provider that grants
// credits or an item turns this verb into a faucet with a walking pace as its
// only limit. Providers here return KNOWLEDGE — a thing is here, a seam exists,
// something came out from behind the crates. If you want loot, extend the
// scavenging tables, which are stocked per zone and deplete.
//
// NO PERCEPTION SKILL EXISTS (server/engine/skills.js) and this is not the place
// to invent one — a new skill is a permanent addition to every character sheet
// and every UI that lists them. Searching rolls `scavenging`, whose governing
// stats (brains + reflexes) already say exactly "did you notice the thing in
// the mess".

import { gatherHook } from '../../server/engine/plugins.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getZone } from '../../server/engine/world.js';

// ---------------------------------------------------------------------------
// Prose
//
// Failure is the common case and is read far more often than any success, so it
// rotates. Every line says the same thing twice — there's nothing here, and the
// room is not empty — because that ambiguity is the whole feeling the verb is
// for. None of them ever hint that a specific thing was missed: a near-miss
// message would turn `search` into a detector, and the point is that you cannot
// tell an empty room from an unlucky one.

const FAILURES = [
  "You turn over what there's to turn over. Grit, a dead battery, and the strong sense of being watched by nothing.",
  'You go through it properly. Wrappers, rust, a bottle cap. Whatever else is here is better at this than you are.',
  'Nothing. The kind of nothing that has clearly been nothing for a while.',
  'You check the corners, the gaps, the places things end up. The city has already been through here.',
  'You find a boot. One boot. You put it back roughly where you found it.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
// Cooldown
//
// RAM-only, per player per zone. A lost cooldown on restart costs one free
// search, which is nothing — so this deliberately does not touch player_flags.
// It exists to stop `search` being spammed as a free detector, not to be an
// economy.

const COOLDOWN_MS = 30_000;
const lastSearch = new Map(); // `${playerId}:${zoneId}` -> epoch ms

// ---------------------------------------------------------------------------

async function cmdSearch(args, raw, player, broadcast) {
  const targetStr = args.join(' ').trim();
  const zoneId = player.current_zone;
  const zone = getZone(zoneId);
  if (!zone) return { type: 'error', message: "There's nothing here to search." };

  const key = `${player.id}:${zoneId}`;
  if (Date.now() - (lastSearch.get(key) || 0) < COOLDOWN_MS) {
    return { type: 'error', message: "You've just been through here. Give it a minute." };
  }
  lastSearch.set(key, Date.now());

  // Searching is conspicuous. You are visibly on your knees going through
  // somebody's bins, and the room gets to know that.
  broadcast(zoneId, { type: 'zone_event', message: `${player.handle} starts turning things over.` }, player.id);

  // ONE roll for the whole search; each provider reads the margin and sets its
  // own bar. Rolling per provider would mean a room with more findable things in
  // it is EASIER to search, which is backwards.
  const roll = await skillCheck(player, 'scavenging', 4);
  awardSkillUse(player.id, 'scavenging', roll.margin).catch(() => {});

  // Providers return { found: true, message, priority? } or nothing. Errors in
  // one are isolated by gatherHook itself.
  const found = await gatherHook('search.provider', {
    player, zoneId, zone, targetStr,
    margin: roll.margin, effective: roll.effective, success: roll.success,
    broadcast,
  });

  const hits = found.filter((f) => f?.found && f.message);
  if (!hits.length) return { type: 'output', message: pick(FAILURES) };

  // Lowest priority first, and only the winner is reported. A search turns up
  // ONE thing — reporting everything at once would make a good roll in a busy
  // room read like an inventory screen, and would tell the player exactly how
  // much there was left to find.
  hits.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return { type: 'output', message: hits[0].message };
}

export const commands = { search: cmdSearch };

export const _test = { FAILURES, COOLDOWN_MS, lastSearch };
