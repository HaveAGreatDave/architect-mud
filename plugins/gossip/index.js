// plugins/gossip/index.js
//
// Gossip — a global rumour pool fed by real in-game events. NPCs recall the
// juiciest, most recent, most local item when a player asks; players can plant
// their own rumours (true or false); and items carry optional "leads" (a dim
// hint pointing at a zone/subject) so gossip is worth chasing, not just flavour.
//
// Propagation is "global pool + local recall": events drop into one shared pool
// (pool.js) and locality is a recall-time weighting, never NPC-to-NPC travel.
//
// Seams used: the event bus (on/emit), formatChitchat for NPC speech, SIFT for
// "ask <npc>", the deception skill for rumour believability, a player Flag for
// the spread cooldown, and getPowerMap diffing in the tick for blackout news.

import { on, emit } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getZone, getZoneNpcs, world } from '../../server/engine/world.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { getBuildingName } from '../../server/engine/apartments.js';
import { sendToZone } from '../../server/engine/messaging.js';
import * as pool from './pool.js';
import { TEMPLATES, renderItem } from './templates.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const AMBIENT_CHANCE      = 0.06;     // per witnessed zone per tick, unprompted gossip
const PASSPHRASE_CHANCE   = 0.02;     // per tick chance to seed the (ask-only) dealer-passphrase rumour
const FORTRESS_CHANCE     = 0.02;     // per tick chance to seed the (ask-only) western-fortress rumour
const SPREAD_COOLDOWN_MS  = 60_000;   // between a player's own planted rumours

const zn = (id) => getZone(id)?.name || 'somewhere';

// The DEADBALL roster each NPC's favourite team is drawn from. Pinned once at boot
// from content (broadcast.getSportsTeams — the authoritative, complete team list),
// so allegiances are drawn from a FIXED set: stable from the very first game and
// never shifting as more matchups air. If content isn't reachable, it falls back to
// self-populating from `sports.game` events until the pin lands (a bare/test world).
//
// An NPC's allegiance is a stable hash of its id into the sorted roster —
// deterministic across restarts, uniform over the league, no schema. Because the
// roster is fixed, `favTeam(npc)` returns the same team for the life of the world.
const teamRoster = new Set();
let rosterPinned = false;   // true once the full content roster is loaded

function favTeam(npc) {
  if (!npc?.id || teamRoster.size === 0) return null;
  const teams = [...teamRoster].sort();
  const s = String(npc.id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return teams[h % teams.length];
}

// Pin the full roster from content. Retried a few times post-boot because the
// broadcast plugin (and its content) may not be ready the instant gossip loads.
async function pinRoster(attempt = 0) {
  const res = await dispatchAction({ type: 'broadcast.getSportsTeams' }).catch(() => null);
  const teams = Array.isArray(res?.teams) ? res.teams : [];
  if (teams.length) {
    for (const t of teams) teamRoster.add(t);
    rosterPinned = true;
    return;
  }
  if (attempt < 5) setTimeout(() => pinRoster(attempt + 1).catch(() => {}), 10_000);
}
setTimeout(() => pinRoster().catch((e) => console.error('[gossip] roster pin:', e.message)), 7000);

// Player handles are proper nouns that land mid-sentence in rumour templates —
// capitalize the first letter so "dave" reads as "Dave". Idempotent on names
// that are already cased; returns falsy input untouched so `pc(x) || 'someone'`
// fallbacks still work.
const pc = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The broad area a zone belongs to — its building name for an interior room,
// else the zone's own name. Weather is area-wide, so gossip reads "over the
// Meridian" not "over Unit 1A". Reuses the engine's building resolver.
function areaName(zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return 'somewhere';
  if (zone.flags?.is_apartment || zone.flags?.is_interior) return getBuildingName(zone) || zone.name;
  return zone.name || 'somewhere';
}

// Zone-graph BFS hop distance, bounded by maxHops (used for recall proximity).
function hopDistance(fromZone, toZone, maxHops) {
  if (fromZone === toZone) return 0;
  const seen = new Set([fromZone]);
  let frontier = [fromZone];
  for (let d = 1; d <= maxHops; d++) {
    const next = [];
    for (const z of frontier) {
      const zone = getZone(z);
      if (!zone) continue;
      for (const nb of neighborZoneIds(zone)) {
        if (nb === toZone) return d;
        if (seen.has(nb)) continue;
        seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return Infinity;
}

// ── Ingestion ─────────────────────────────────────────────────────────────────
// Duplicate suppression is handled in pool.addItem by coalescing (a repeated
// event refreshes one warm item rather than piling rows). Callers may pass a
// `coalesceKey` to control what counts as "the same" story.
function add(templateKey, { zoneId, subjectName, subjectId, vars, lead, coalesceKey, capGroup, askOnly } = {}) {
  const t = TEMPLATES[templateKey];
  if (!t) return;
  pool.addItem({ category: t.category, templateKey, reach: t.reach, heat: t.heat,
    zoneId, subjectName, subjectId, vars, lead, coalesceKey, capGroup, askOnly });
}

on('player.death', ({ player, killer }) => {
  if (!player?.id) return;
  const zoneId = player.current_zone;
  add('kill_player', {
    zoneId, subjectName: player.handle, subjectId: player.id,
    vars: { victim: pc(player.handle), killer: pc(killer?.handle) || killer?.name || 'someone', zone: zn(zoneId) },
    lead: { kind: 'loot', zoneId, hint: `${player.handle} dropped everything around ${zn(zoneId)}` },
  });
});

on('enemy.killed', async ({ actor, enemy }) => {
  if (!actor?.handle || !enemy) return;
  const zoneId = actor.current_zone;
  // A newbie's very first kill is news — louder, global, and about them by name.
  if (actor.id && !(await getFlag('player', 'gossip_first_kill', actor))) {
    await setFlag('player', 'gossip_first_kill', 'true', actor);
    add('first_blood', { zoneId, subjectName: actor.handle, subjectId: actor.id,
      vars: { subject: pc(actor.handle), zone: zn(zoneId) } });
    return;
  }
  add('kill_enemy', { zoneId, subjectName: actor.handle,
    vars: { killer: pc(actor.handle), victim: enemy.name, zone: zn(zoneId) } });
});

on('npc.killed', ({ actor, npc }) => {
  if (!npc) return;
  const zoneId = actor?.current_zone || npc.zone_id;
  add('kill_npc', { zoneId, subjectName: npc.name,
    vars: { killer: pc(actor?.handle) || 'someone', victim: npc.name, zone: zn(zoneId) } });
});

// Witness-gated in surveillance's raiseCrime — we only hear about ones that stuck.
on('crime.witnessed', ({ player, key, zoneId, label }) => {
  if (!player?.id) return;
  add('crime', {
    zoneId, subjectName: player.handle, subjectId: player.id, coalesceKey: `crime|${player.id}|${key}`,
    vars: { suspect: pc(player.handle), label: (label || 'a crime').toLowerCase(), zone: zn(zoneId) },
    lead: { kind: 'target', targetId: player.id, zoneId, hint: `${player.handle} was last seen around ${zn(zoneId)}` },
  });
});

on('police.dispatch', ({ zoneId, reason, suspect }) => {
  if (!suspect) return;
  add('crime', {
    zoneId, subjectName: suspect, coalesceKey: `crime|${suspect}|dispatch`,
    vars: { suspect: pc(suspect), label: (reason || 'trouble').toLowerCase(), zone: zn(zoneId) },
    lead: { kind: 'target', zoneId, hint: `${suspect} was last seen around ${zn(zoneId)}` },
  });
});

on('player.drugUsed', ({ player, illegal, zoneId }) => {
  if (!player?.id || !illegal) return;
  const z = zoneId || player.current_zone;
  add('crime', { zoneId: z, subjectName: player.handle, subjectId: player.id, coalesceKey: `crime|${player.id}|drug`,
    vars: { suspect: pc(player.handle), label: 'using out in the open', zone: zn(z) } });
});

on('gossip.pokerWin', async ({ player, amount, zoneId }) => {
  if (!player?.id) return;
  // First win at the table gets the newcomer named across town.
  if (!(await getFlag('player', 'gossip_first_pokerwin', player))) {
    await setFlag('player', 'gossip_first_pokerwin', 'true', player);
    add('first_score', { zoneId, subjectName: player.handle, subjectId: player.id,
      vars: { subject: pc(player.handle), amount, zone: zn(zoneId) } });
    return;
  }
  add('poker_win', { zoneId, subjectName: player.handle, subjectId: player.id,
    vars: { subject: pc(player.handle), amount, zone: zn(zoneId) } });
});

// A newbie's FIRST purchase (any price) ripples — even a quiet player gets seen.
// Everyday big spends stay gated at ≥500c via the separate gossip.bigBuy path.
on('vendor.purchase', async ({ player, zoneId }) => {
  if (!player?.id) return;
  if (await getFlag('player', 'gossip_first_buy', player)) return;
  await setFlag('player', 'gossip_first_buy', 'true', player);
  const z = zoneId || player.current_zone;
  add('first_deal', { zoneId: z, subjectName: player.handle, subjectId: player.id,
    vars: { subject: pc(player.handle), zone: zn(z) } });
});

on('gossip.bigBuy', ({ player, itemName, price, zoneId }) => {
  if (!player?.id) return;
  add('big_buy', { zoneId, subjectName: player.handle, subjectId: player.id,
    vars: { subject: pc(player.handle), item: itemName, amount: price, zone: zn(zoneId) } });
});

on('gossip.housing', ({ player, zoneId }) => {
  if (!player?.id) return;
  add('housing', { zoneId, subjectName: player.handle, subjectId: player.id,
    vars: { subject: pc(player.handle), zone: zn(zoneId) } });
});

// A DEADBALL game just aired (broadcast sims one every airing and emits the
// decided result). Drop the box score into the pool as global, mid-heat sports
// talk — capped as its own group so a busy schedule can't bury real news. Every
// game keyed by gameId so a mid-window re-sim (restart) coalesces, not piles.
// Each team seen feeds the roster that NPC allegiances (favTeam) are drawn from.
on('sports.game', ({ gameId, away, home, awayScore, homeScore, winner }) => {
  if (!away || !home || awayScore == null || homeScore == null) return;
  if (winner !== away && winner !== home) return;
  // Fallback only: until the content roster is pinned, learn teams from the games
  // themselves so a bare world still has allegiances. Once pinned, the set is frozen.
  if (!rosterPinned) { teamRoster.add(away); teamRoster.add(home); }
  add('sports_score', {
    coalesceKey: `sports|${gameId || `${away}|${home}`}`, capGroup: 'sports',
    vars: { away, home, awayScore, homeScore, winner },
  });
});

on('weather.thunder', ({ zoneId }) => {
  if (!zoneId) return;
  // Weather is area-wide: name the building, and coalesce by area so a storm
  // that thunders across every room of a block stays one rumour, not twenty.
  const area = areaName(zoneId);
  add('storm', { zoneId, vars: { zone: area }, coalesceKey: `storm|${area}`, capGroup: 'weather' });
});

// ── Telling ─────────────────────────────────────────────────────────────────
const stripQuotes = (s) => s.trim().replace(/^"|"$/g, '');

// An NPC eligible to gossip: alive, not fighting, not mid-shop, not muzzled.
function gossipNpcs(zoneId) {
  return (getZoneNpcs(zoneId) || []).filter(n =>
    n && !n._dead && !n._combatTargetId && !n._ai?.shopPaused && !n.flags?.no_banter);
}

// listener (optional): the player hearing the line. When they ARE the rumour's
// subject, the NPC turns it on them — second person, to their face.
// speaker (optional): the NPC voicing the line — its favourite team colours
// sports gossip (gloat / grumble / neutral). Other templates ignore the ctx.
function spokenLine(item, listener = null, speaker = null) {
  const aboutYou = !!(item.subjectId && listener && listener.id === item.subjectId);
  let line = renderItem(item, aboutYou, { fav: favTeam(speaker) });
  if (!line) return null;
  // A poorly-planted (low-truth) rumour is repeated with an audible shrug.
  if (item.planted && item.truth < 0.5) line = `"Somebody's been saying ${stripQuotes(line)}. Could be nothing."`;
  return line;
}

// The dim follow-up hint that makes a lead worth chasing. Flavour only in v1;
// FUTURE: a `follow`/bounty verb would consume the lead and emit gossip.leadFollowed.
function leadHint(item) {
  const hint = item.lead?.hint;
  return hint ? { type: 'output', message: `<span class="text-dim">(${hint}.)</span>` } : null;
}

function speakGossip(player, npc, broadcast) {
  const zoneId = player.current_zone;
  const [item] = pool.recall(zoneId, { n: 1, distanceFn: hopDistance });
  if (!item) {
    const shrug = formatChitchat(npc.name, `shrugs. "Haven't heard anything worth repeating."`);
    broadcast?.(zoneId, shrug, player.id);
    return shrug;
  }
  const line = spokenLine(item, player, npc);
  const msg = formatChitchat(npc.name, line);
  broadcast?.(zoneId, msg, player.id);
  const hint = leadHint(item);
  if (hint) return { type: 'output', message: `${msg.message}\n${hint.message}` };
  return msg;
}

// ── Verbs ─────────────────────────────────────────────────────────────────────

// gossip            → a random talkative NPC in the room shares the word
// gossip <npc>      → ask a specific NPC
function cmdGossip(args, raw, player, broadcast) {
  const zoneId = player.current_zone;
  const targetStr = args.join(' ').trim();

  if (targetStr) {
    const r = siftResolve(targetStr, getZoneNpcs(zoneId) || []);
    if (r.type === 'none') return { type: 'error', message: `There's no "${targetStr}" here to ask.` };
    if (r.type === 'ambiguous') {
      createSelectionState(player.id, r.candidates, { dispatchType: 'gossip.ask_npc', dispatchParam: 'target' });
      return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
    }
    return speakGossip(player, r.candidate, broadcast);
  }

  const npcs = gossipNpcs(zoneId);
  if (!npcs.length) return { type: 'output', message: "There's nobody around here to gossip with." };
  return speakGossip(player, npcs[Math.floor(Math.random() * npcs.length)], broadcast);
}

// ask <npc> about gossip|rumours|news|word
function cmdAskAbout(args, raw, player, broadcast) {
  const m = raw.match(/^ask\s+(.+?)\s+about\s+(?:gossip|rumou?rs?|news|word)\s*$/i);
  if (!m) return undefined;
  const r = siftResolve(m[1], getZoneNpcs(player.current_zone) || []);
  if (r.type === 'none') return { type: 'error', message: `There's no "${m[1]}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'gossip.ask_npc', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return speakGossip(player, r.candidate, broadcast);
}

// spread <text> / rumor <text> — plant a rumour. Believability rides a deception
// check: a good con reads as true and gets repeated; a botch still plants, but weak.
async function cmdSpread(args, raw, player, broadcast) {
  const text = raw.replace(/^\s*(spread|rumou?r)\s+/i, '').trim();
  if (!text) return { type: 'error', message: 'Spread what? Try: spread <the word on the street>.' };
  if (text.length > 200) return { type: 'error', message: 'Keep it short — nobody repeats a speech.' };

  const until = Number(await getFlag('player', 'gossip_spread_until', player)) || 0;
  if (Date.now() < until) {
    return { type: 'error', message: `You've been running your mouth too much. Give it ${Math.ceil((until - Date.now()) / 1000)}s.` };
  }

  const check = await skillCheck(player, 'deception', 5);
  // Spreading word trains Deception whether it lands true or clumsy (abs margin).
  await awardSkillUse(player.id, 'deception', check.margin);
  const truth = Math.max(0.1, Math.min(0.95, 0.3 + check.margin * 0.05));
  pool.plant({ text, zoneId: player.current_zone, truth, subjectName: player.handle });
  await setFlag('player', 'gossip_spread_until', String(Date.now() + SPREAD_COOLDOWN_MS), player);

  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} mutters something to the people nearby.` }, player.id);
  return { type: 'output', message: check.success
    ? 'You lean in and let it slip, just quiet enough to travel. It lands as true — people will pass it on.'
    : 'You put the word out, but it comes out clumsy. Most who hear it just raise an eyebrow.' };
}

// Ambiguous "ask <npc>" / "gossip <npc>" replay lands here with the chosen NPC.
registerAction({
  type: 'gossip.ask_npc',
  handler: ({ actor, params, context }) => speakGossip(actor, params.target, context.broadcast),
});

// Dialogue hook: a "gossip"/"any news?" option on a chatty NPC (barkeeps, etc.)
// dispatches this to surface one *live* pool rumour instead of canned text. The
// dialogue handler appends the returned `dialogue_line` to the node's panel text.
// Panel-only — a quiet word across the bar, not a zone-wide performance.
//
// Per-(player, NPC) cooldown: once an NPC gives up the word, they've got nothing
// new for a while and say so. In-memory (resets on restart) — a cooldown this
// short doesn't warrant a persisted Flag.
const GOSSIP_TELL_COOLDOWN_MS = 90_000;
const tellCooldowns = new Map();  // `${playerId}:${npcId}` -> expiry ts

const DRY_LINES = [
  `"That's all I've got right now. Check back later."`,
  `"Nothing new since you asked. Give it a bit."`,
  `"I've said my piece. Come back when the wind changes."`,
  `"Wire's quiet on my end. Ask me again later."`,
  `"You've had everything I know. For now."`,
  `"Slow news hour. Try me again in a while."`,
];
const pickDry = () => DRY_LINES[Math.floor(Math.random() * DRY_LINES.length)];

registerAction({
  type: 'GOSSIP_TELL',
  handler: ({ actor, context }) => {
    const npcId = context?.npc?.id;
    const key = `${actor?.id}:${npcId}`;
    const now = Date.now();
    if (npcId && now < (tellCooldowns.get(key) || 0)) {
      return { type: 'dialogue_line', text: pickDry() };
    }
    const [item] = pool.recall(actor?.current_zone, { n: 1, distanceFn: hopDistance });
    const line = item && spokenLine(item, actor, context?.npc);
    if (!line) return { type: 'dialogue_line', text: `"Quiet, for once. Nothing worth passing on."` };
    if (npcId) tellCooldowns.set(key, now + GOSSIP_TELL_COOLDOWN_MS);
    return { type: 'dialogue_line', text: line };
  },
});

registerInputMatcher(/^ask\s+.+\s+about\s+(?:gossip|rumou?rs?|news|word)\s*$/i, cmdAskAbout, 'gossip');

// ── Tick: gc + blackout news + passphrase seed + ambient gossip ────────────────
const lastPower = new Map();

// Rarely put the shadow dealer's passphrase into circulation as an ask-only
// secret. Asks the dealer plugin for the phrase live *this* rotation window
// (dealer.passphrase action), so gossip never leaks a phrase that's already
// expired. Falls back to the raw pool if the dealer plugin isn't loaded.
async function seedPassphraseGossip() {
  let dealer = null;
  for (const npc of world.npcs.values()) {
    if (npc?.npc_type === 'dealer' && npc.flags?.covert && Array.isArray(npc.flags?.passphrases) && npc.flags.passphrases.length) { dealer = npc; break; }
  }
  if (!dealer) return;
  const rot = await dispatchAction({ type: 'dealer.passphrase', params: { npc: dealer } });
  const phrase = rot?.active || dealer.flags.passphrases[0];
  if (!phrase) return;
  const dz = dealer.zone_id;
  add('dealer_phrase', {
    zoneId: dz, subjectName: 'the shadow dealer', coalesceKey: 'dealer_phrase', askOnly: true,
    vars: { phrase },
    lead: dz ? { kind: 'place', zoneId: dz, hint: `the figure works after dark around ${zn(dz)}` } : null,
  });
}

function gossipTick() {
  pool.gc();

  // Blackout / power-restored news, derived by diffing the power map (no engine emit).
  for (const e of getPowerMap()) {
    const powered = (s) => s === 'powered' || s === 'overloaded';
    const prev = lastPower.get(e.zoneId);
    if (prev !== undefined && powered(prev) !== powered(e.status)) {
      add(powered(e.status) ? 'power_back' : 'blackout', { zoneId: e.zoneId, vars: { zone: zn(e.zoneId) } });
    }
    lastPower.set(e.zoneId, e.status);
  }

  if (Math.random() < PASSPHRASE_CHANCE) seedPassphraseGossip().catch(e => console.error('[gossip] passphrase seed:', e.message));

  // The western chrome fortress — an ask-only rumour of the Ascendant campus (its
  // existence only; the Halcyon tie stays behind the Gate). Coalesced so it stays one.
  if (Math.random() < FORTRESS_CHANCE) add('asc_fortress', { coalesceKey: 'asc_fortress', askOnly: true, subjectName: 'the western fortress', vars: {} });

  // Unprompted gossip — low chance, only in zones with a player watching. Ask-only
  // items (e.g. the dealer passphrase) are excluded here; they surface only on ask.
  if (AMBIENT_CHANCE <= 0) return;
  for (const [zoneId, zone] of world.zones) {
    if (!zone.players || zone.players.size === 0) continue;
    if (Math.random() > AMBIENT_CHANCE) continue;
    const npcs = gossipNpcs(zoneId);
    if (!npcs.length) continue;
    const [item] = pool.recall(zoneId, { n: 1, distanceFn: hopDistance, filter: (i) => !i.askOnly });
    if (!item) continue;
    // Pick the speaker first — their favourite team colours a sports box score.
    const speaker = npcs[Math.floor(Math.random() * npcs.length)];
    const line = spokenLine(item, null, speaker);
    if (line) sendToZone(zoneId, formatChitchat(speaker.name, line));
  }
}

schedule('1m', () => { try { gossipTick(); } catch (e) { console.error('[gossip] tick error:', e.message); } });

// ── Dev-panel route: live gossip pool inspector (read-only) ────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/gossip')) return null;
  if (!auth || !['dev', 'admin', 'builder', 'designer'].includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }
  if (method === 'DELETE') {
    const parts = path.split('/').filter(Boolean);  // ['gossip', id?]
    if (parts.length === 1) { const cleared = pool.size(); pool.clear(); return { status: 200, body: { ok: true, cleared } }; }
    return { status: 200, body: { ok: pool.remove(decodeURIComponent(parts[1])) } };
  }

  // Spread a rumour as a chosen NPC — a dev-side `spread`, planted into the pool
  // at that NPC's zone (so it recalls locally there) and attributed to their name.
  if (method === 'POST' && path === '/gossip') {
    const npcId = String(body?.npcId || '').trim();
    const text  = String(body?.text || '').trim();
    if (!npcId) return { status: 400, body: { error: 'Pick an NPC to spread the rumour.' } };
    if (!text)  return { status: 400, body: { error: 'Enter what the NPC should spread.' } };
    if (text.length > 200) return { status: 400, body: { error: 'Keep it short — under 200 characters.' } };
    const npc = world.npcs.get(npcId);
    if (!npc) return { status: 404, body: { error: 'NPC not found.' } };
    const item = pool.plant({ text, zoneId: npc.zone_id, truth: 0.9, subjectName: npc.name });
    return { status: 200, body: { ok: true, id: item?.id } };
  }

  if (path === '/gossip' && method === 'GET') {
    const now = Date.now();
    const rows = pool.all().map((i) => ({
      id: i.id,
      category: i.category,
      subject: esc(i.subjectName || '—'),
      zone: esc(getZone(i.zoneId)?.name || i.zoneId || '—'),
      text: esc(renderItem(i) || ''),
      strength: Number(pool.weight(i, i.zoneId, null, now).toFixed(3)),
      reach: i.reach,
      planted: i.planted,
      truth: i.planted ? Number(i.truth.toFixed(2)) : null,
      age_s: Math.round((now - i.ts) / 1000),
      lead: i.lead?.kind || '',
    })).sort((a, b) => b.strength - a.strength);
    return { status: 200, body: rows };
  }
  return null;
};

export const commands = { gossip: cmdGossip, spread: cmdSpread, rumor: cmdSpread };
