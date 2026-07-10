// plugins/corps/index.js
//
// Phase 0 corporations. Player crews and NPC factions share the unified `orgs`
// table (NPC factions are is_npc=1, owner-less). This plugin owns only player-
// crew behaviour: identity, custom ranks + permission bits, an atomic shared
// treasury, a private per-corp channel, and a claimable HQ that reuses the
// apartment substrate. All verbs route through `corp`/`org` to avoid collisions.
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import {
  getOrg, getOrgByName, getPlayerMembership, reloadOrg, removeOrgFromCache,
  getAllLivePlayers, getZone, getAllZones, getApartment, setApartmentCache,
  getZoneControl, setZoneControlCache, getOrgZones, getAllZoneControl,
  getZoneAssets, getOrgAssets, reloadZoneAssets,
} from '../../server/engine/world.js';
import { PERM, PERM_ALL, hasPerm } from '../../server/engine/org-perms.js';
import { zoneDanger } from '../../server/engine/danger.js';
import { releaseCorpHq } from '../../server/engine/apartments.js';
import { sendToChatChannel } from '../../server/engine/channels.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { schedule } from '../../server/engine/scheduler.js';

const FOUND_FEE = 1000;            // credits to found a corp
const HQ_FEE = 500;                // credits (from treasury) to claim an HQ
const HQ_LOCK_DIFFICULTY = 4;      // matches apartments' base
const INVITE_TTL_MS = 120000;      // 2 minutes
const MAX_NAME = 40;

// ── Territory (Phase 1) tunables ──
const TERRITORY_CLAIM_FEE = 300;   // credits (from treasury) to claim a zone
const START_INFLUENCE = 50;        // grip a newly-claimed/flipped zone begins at
const REINFORCE_COST = 20;         // credits per +1 grip point
const CONTEST_COOLDOWN_MS = 30000; // per-player anti-spam on contesting
const CONSOLIDATE_PER_DAY = 10;    // uncontested grip drift toward 100 / 24h tick
const ERODE_PER_DAY = 8;           // contested grip decay toward 0 / 24h tick

// ── Investment (Phase 2) tunables ──
const MAX_TIER = 5;
// Cost (from treasury) to REACH tier index; tier 1 is free (index 0/1 unused/0).
const TIER_COST = [0, 0, 2500, 6000, 12000, 24000];
const MEMBER_CAP = [0, 5, 10, 20, 35, 50];       // by tier
const TERRITORY_SLOTS = [0, 2, 4, 7, 11, 16];    // max controlled zones by tier
// Buildable assets. cost = base + level*perLevel; effect scales with level.
const ASSETS = {
  extractor: { name: 'extractor', label: 'Extractor', base: 400, perLevel: 250, income: 60 },   // +income/day per level
  turret:    { name: 'turret',    label: 'Turret',    base: 500, perLevel: 300, defense: 3 },    // −grip lost per level (contest + tick)
};
const tierCap = (t) => Math.max(0, Math.min(MAX_TIER, t || 1));
const memberCap = (t) => MEMBER_CAP[tierCap(t)];
const territorySlots = (t) => TERRITORY_SLOTS[tierCap(t)];
// Total turret defense on a zone (sum of turret levels × per-level).
function zoneDefense(zoneId) {
  return getZoneAssets(zoneId).filter(a => a.type === 'turret').reduce((s, a) => s + a.level * ASSETS.turret.defense, 0);
}
// Extractor income bonus for a zone.
function zoneExtractorIncome(zoneId) {
  return getZoneAssets(zoneId).filter(a => a.type === 'extractor').reduce((s, a) => s + a.level * ASSETS.extractor.income, 0);
}

// playerId -> timestamp of last contest (anti-spam)
const contestCooldown = new Map();

// A zone is claimable territory if it's contestable ground: non-safe by danger,
// or explicitly flagged. Safe hubs and apartments are never territory.
function isClaimableZone(zone) {
  if (!zone || zone.flags?.is_apartment) return false;
  if (zone.flags?.claimable === true) return true;
  if (zone.flags?.claimable === false) return false;
  // Inferred danger: getAllZones() rows carry it as .danger; live world zone
  // objects compute it via zoneDanger() (their cache field isn't in payloads).
  return (zone.danger ?? zoneDanger(zone)) !== 'safe';
}

// Architect attention 0..100 for an org — concentration of power (zones held +
// treasury + tier + assets). A telegraph for now; "optimization" events come later.
function architectHeat(org, zoneCount, assetCount = 0) {
  const byZones = (zoneCount || 0) * 12;
  const byTreasury = Math.floor((org?.treasury || 0) / 5000) * 5;
  const byTier = ((org?.tier || 1) - 1) * 8;
  const byAssets = (assetCount || 0) * 3;
  return Math.max(0, Math.min(100, byZones + byTreasury + byTier + byAssets));
}

// targetPlayerId -> { orgId, orgName, expiresAt }
const pendingInvites = new Map();

const PERM_NAMES = {
  invite: PERM.INVITE, kick: PERM.KICK, edit_ranks: PERM.EDIT_RANKS,
  disburse: PERM.DISBURSE, edit_corp: PERM.EDIT_CORP, manage_hq: PERM.MANAGE_HQ,
  disband: PERM.DISBAND,
};

const err = (message) => ({ type: 'error', message });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Corps must stay visually distinct on the map. The schema default (#888888)
// counts as "unclaimed" — a corp that never chose a colour doesn't reserve grey.
const MIN_COLOR_DISTANCE = 120;               // redmean scale, ~0..765 (kept for map legends / regress)
const isHex6 = (s) => /^#[0-9a-fA-F]{6}$/.test(s || '');
const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
// Low-cost perceptual colour distance ("redmean" approximation).
function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// The tablet colour picker's swatches — pairwise ≥141 apart (> MIN_COLOR_DISTANCE),
// so any subset is mutually distinct. Custom hex still routes through cmdEdit.
const CORP_PALETTE = ['#e0413a', '#e8c62e', '#35c95a', '#2f9fd6', '#6a4de8', '#e04db0', '#b07a4a', '#9aa5ad', '#f0f0f0', '#5a6470'];

// Quick-pick preset swatches offered next to the free colour wheel. No
// distinctness gate — every preset is always selectable (corps may share hues).
export async function corpColorOptions() {
  return CORP_PALETTE.map(hex => ({ hex, available: true }));
}

const liveById = (id) => getAllLivePlayers().find(p => p.id === id) || null;
const findOnline = (h) => getAllLivePlayers().find(p => (p.handle || '').toLowerCase() === String(h || '').toLowerCase()) || null;

function parsePerms(str) {
  const bad = [];
  let bits = 0;
  for (const raw of String(str || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (raw === 'all') bits |= PERM_ALL;
    else if (raw === 'none') continue;
    else if (PERM_NAMES[raw] != null) bits |= PERM_NAMES[raw];
    else bad.push(raw);
  }
  return { bits, bad };
}
function permLabel(bits) {
  if (bits === PERM_ALL) return 'all';
  const names = Object.entries(PERM_NAMES).filter(([, b]) => bits & b).map(([n]) => n);
  return names.length ? names.join(',') : 'none';
}
function myRankOrder(org, membership) {
  return org.ranks.find(r => r.id === membership.rank_id)?.rank_order ?? 0;
}

// ─── Commands ─────────────────────────────────────────────────────────────

// A short display tag for a corp (flags.tag, else first alnum letters of the name).
function deriveTag(org) {
  if (org?.flags?.tag) return org.flags.tag;
  const letters = (org?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.slice(0, 4) || 'ORG';
}

// Assemble the rich Corp Command Console payload (rendered by panels/corp-console.js).
// Phase-0 data: identity, treasury, members, diplomacy. Territory/directives are
// stubs until the Phase-1 zone_control engine lands (income/upkeep/heat = 0).
async function buildConsolePayload(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err('You are not in a corp. Found one with "corp found <name>".');
  const org = getOrg(m.org_id);
  const myRank = org.ranks.find(r => r.id === m.rank_id);

  const { rows: memRows } = await query(
    `SELECT p.id, p.handle, r.name AS rank, r.rank_order FROM org_members om
       JOIN players p ON p.id = om.player_id JOIN org_ranks r ON r.id = om.rank_id
      WHERE om.org_id = $1 ORDER BY r.rank_order DESC, LOWER(p.handle)`, [m.org_id]);
  const online = new Set(getAllLivePlayers().map(p => p.id));
  const members = memRows.map(r => ({ handle: r.handle, rank: r.rank, online: online.has(r.id) }));

  const { rows: relRows } = await query(
    `SELECT o.name, rel.stance FROM org_relations rel JOIN orgs o ON o.id = rel.other_org_id
      WHERE rel.org_id = $1 ORDER BY o.name`, [m.org_id]);
  const relations = relRows.map(r => ({ name: r.name, stance: r.stance }));

  // Territory: controlled zones (influence grip), with HQ zones marked.
  const zones = getOrgZones(m.org_id);
  const hqSet = new Set((await query('SELECT zone_id FROM apartments WHERE owner_org_id=$1', [m.org_id])).rows.map(r => r.zone_id));
  const territory = zones.map(z => ({
    zone: getZone(z.zone_id)?.name || z.zone_id,
    status: hqSet.has(z.zone_id) ? 'HQ' : (z.challenger_org_id ? 'CONTESTED' : 'HELD'),
    influence: z.influence,
    challenger: z.challenger_org_id ? (getOrg(z.challenger_org_id)?.name || null) : null,
  }));
  for (const zid of hqSet) if (!zones.find(z => z.zone_id === zid)) {
    territory.push({ zone: getZone(zid)?.name || zid, status: 'HQ', influence: 100, challenger: null });
  }
  const income = zones.reduce((s, z) => s + (z.base_income || 0) + zoneExtractorIncome(z.zone_id), 0);
  const upkeep = zones.reduce((s, z) => s + (z.base_upkeep || 0), 0);
  const tier = tierCap(org.tier);
  const assetCount = getOrgAssets(m.org_id).length;

  return {
    type: 'corp_console',
    accent: org.color || '#35e0c8',
    org: { name: org.name, tag: deriveTag(org), tier },
    you: { rank: myRank?.name || '—', permissions: m.permissions },
    treasury: { balance: org.treasury || 0, income, upkeep },
    tierInfo: { tier, memberCap: memberCap(tier), members: members.length, slots: territorySlots(tier), zones: zones.length, nextCost: tier < MAX_TIER ? TIER_COST[tier + 1] : null },
    members,
    relations,
    territory,
    directives: [],
    architectHeat: architectHeat(org, zones.length, assetCount),
  };
}

// Push a live console patch to every online member of an org (after treasury/
// roster changes), so an open console updates without a manual refresh.
async function pushConsole(orgId, broadcast) {
  if (!broadcast) return;
  for (const p of getAllLivePlayers()) {
    if (getPlayerMembership(p.id)?.org_id !== orgId) continue;
    const payload = await buildConsolePayload(p);
    if (payload.type === 'corp_console') {
      broadcast(null, { type: 'corp_console_patch', treasury: payload.treasury, architectHeat: payload.architectHeat, members: payload.members, territory: payload.territory, tierInfo: payload.tierInfo }, null, p.id);
    }
  }
}

// Standalone strategic map payload: placed zones on the current map, tinted by
// controlling org, with per-zone influence + a legend of orgs present.
async function cmdCorpMap(player) {
  const m = getPlayerMembership(player.id);
  const cur = getZone(player.current_zone);
  const mapId = cur?.map_id || 'map_world';
  const gz = cur?.grid_z ?? 0;
  const orgsSeen = new Map();
  const tiles = [];
  for (const z of getAllZones()) {
    if (z.map_id !== mapId || (z.grid_z ?? 0) !== gz) continue;
    if (z.grid_x == null || z.grid_y == null) continue;
    const zc = getZoneControl(z.id);
    let control;
    if (zc?.org_id) {
      const o = getOrg(zc.org_id);
      const ch = zc.challenger_org_id ? getOrg(zc.challenger_org_id) : null;
      control = {
        org_id: zc.org_id, tag: o ? deriveTag(o) : '?', color: o?.color || '#888',
        influence: zc.influence, status: zc.challenger_org_id ? 'CONTESTED' : 'HELD',
        challenger: ch?.name || null, mine: !!(m && zc.org_id === m.org_id),
        income: (zc.base_income || 0) + zoneExtractorIncome(z.id), upkeep: zc.base_upkeep,
        assets: getZoneAssets(z.id).map(a => ({ type: a.type, level: a.level })), defense: zoneDefense(z.id),
      };
      if (o) orgsSeen.set(o.id, { id: o.id, tag: deriveTag(o), color: o.color || '#888', name: o.name });
      if (ch) orgsSeen.set(ch.id, { id: ch.id, tag: deriveTag(ch), color: ch.color || '#888', name: ch.name });
    } else {
      control = { org_id: null, status: isClaimableZone(z) ? 'OPEN' : 'SAFE' };
    }
    // Cardinal exits to neighbours (for the road/avenue network) + artery streets.
    const exits = {};
    for (const dir of ['north', 'south', 'east', 'west']) {
      const e = z.exits?.[dir];
      const tgt = Array.isArray(e) ? e[0] : e;
      if (tgt) exits[dir] = tgt;
    }
    tiles.push({
      id: z.id, x: z.grid_x, y: z.grid_y, name: z.name, danger: z.danger || 'safe',
      isCurrent: z.id === player.current_zone, isStart: z.id === 'zone_city_west',
      artery: z.flags?.artery || null, exits, control,
    });
  }
  return {
    type: 'corp_map',
    accent: (m ? getOrg(m.org_id)?.color : null) || '#35e0c8',
    myOrgId: m?.org_id || null,
    myTag: m ? deriveTag(getOrg(m.org_id)) : null,
    orgs: [...orgsSeen.values()],
    tiles,
  };
}

// Lightweight territory layer for the big city map's "Territory" overlay: only the
// per-zone control of *held* turf, keyed by zone id (colour/tag/influence/mine/
// status), plus an org legend — for whatever map/floor the player's tile sits on.
// The client merges this onto the engine `map` tiles, so the engine map payload
// stays corp-free (unlike `corp map`, this returns no tiles/exits and opens nothing).
async function cmdCorpTerritory(player) {
  const m = getPlayerMembership(player.id);
  const cur = getZone(player.current_zone);
  const mapId = cur?.map_id || 'map_world';
  const gz = cur?.grid_z ?? 0;
  const orgsSeen = new Map();
  const control = {};
  for (const z of getAllZones()) {
    if (z.map_id !== mapId || (z.grid_z ?? 0) !== gz) continue;
    const zc = getZoneControl(z.id);
    if (!zc?.org_id) continue; // only tint turf someone actually holds
    const o = getOrg(zc.org_id);
    const ch = zc.challenger_org_id ? getOrg(zc.challenger_org_id) : null;
    control[z.id] = {
      tag: o ? deriveTag(o) : '?', color: o?.color || '#888',
      influence: zc.influence, status: zc.challenger_org_id ? 'CONTESTED' : 'HELD',
      challenger: ch?.name || null, mine: !!(m && zc.org_id === m.org_id),
    };
    if (o) orgsSeen.set(o.id, { id: o.id, tag: deriveTag(o), color: o.color || '#888', name: o.name });
    if (ch) orgsSeen.set(ch.id, { id: ch.id, tag: deriveTag(ch), color: ch.color || '#888', name: ch.name });
  }
  return {
    type: 'map_territory',
    myOrgId: m?.org_id || null,
    orgs: [...orgsSeen.values()],
    control,
  };
}

async function cmdFound(player, name) {
  if (getPlayerMembership(player.id)) return err("You're already in a corp. Leave it first.");
  name = (name || '').trim();
  if (!name) return err('Found a corp called what? Usage: corp found <name>');
  if (name.length > MAX_NAME) return err(`That name is too long (${MAX_NAME} chars max).`);
  if (getOrgByName(name)) return err(`A corp named "${esc(name)}" already exists.`);
  if ((player.credits || 0) < FOUND_FEE) return err(`Founding a corp costs ${FOUND_FEE}c — you have ${player.credits || 0}c.`);

  const orgId = randomUUID(), founderRank = randomUUID(), memberRank = randomUUID();
  const ok = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -FOUND_FEE, q, 'corp:found')) return false;
    await q('INSERT INTO orgs (id, name, owner_id, is_npc, treasury) VALUES ($1,$2,$3,0,0)', [orgId, name, player.id]);
    await q('INSERT INTO org_ranks (id, org_id, name, rank_order, permissions, is_default) VALUES ($1,$2,$3,$4,$5,$6)',
      [founderRank, orgId, 'Founder', 100, PERM_ALL, 0]);
    await q('INSERT INTO org_ranks (id, org_id, name, rank_order, permissions, is_default) VALUES ($1,$2,$3,$4,$5,$6)',
      [memberRank, orgId, 'Member', 0, 0, 1]);
    await q('INSERT INTO org_members (org_id, player_id, rank_id) VALUES ($1,$2,$3)', [orgId, player.id, founderRank]);
    return true;
  });
  if (!ok) return err("You can't afford that.");
  await reloadOrg(orgId);
  return {
    type: 'corp_founded',
    message: `<span class="skills-header">CORP FOUNDED</span>\nYou found <b>${esc(name)}</b> for ${FOUND_FEE}c. You are its Founder.\nInvite with "corp invite <player>"; fund it with "corp contribute <amount>".`,
    player_update: { credits: player.credits },
  };
}

async function cmdInfo(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return { type: 'corp_info', message: 'You are not in a corp. Found one with "corp found <name>".' };
  const org = getOrg(m.org_id);
  const rank = org.ranks.find(r => r.id === m.rank_id);
  const { rows: [cnt] } = await query('SELECT COUNT(*)::int n FROM org_members WHERE org_id=$1', [m.org_id]);
  const { rows: hqs } = await query('SELECT zone_id FROM apartments WHERE owner_org_id=$1', [m.org_id]);
  const hqNames = hqs.map(h => getZone(h.zone_id)?.name || h.zone_id);
  let msg = `<span class="skills-header">${esc(org.name)}</span>\n`;
  if (org.description) msg += `${esc(org.description)}\n`;
  msg += `\nYour rank: ${esc(rank?.name || '—')} [${permLabel(m.permissions)}]`;
  msg += `\nMembers: ${cnt.n}`;
  msg += `\nTreasury: ${org.treasury}c`;
  msg += `\nHQ: ${hqNames.length ? hqNames.map(esc).join(', ') : '—'}`;
  return { type: 'corp_info', message: msg };
}

async function cmdRoster(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const org = getOrg(m.org_id);
  const { rows } = await query(
    `SELECT p.handle, r.name AS rank FROM org_members om
       JOIN players p ON p.id = om.player_id
       JOIN org_ranks r ON r.id = om.rank_id
      WHERE om.org_id = $1 ORDER BY r.rank_order DESC, LOWER(p.handle)`,
    [m.org_id]);
  let msg = `<span class="skills-header">${esc(org.name)} — ROSTER</span>\n`;
  for (const row of rows) msg += `  ${esc(row.handle)} — ${esc(row.rank)}\n`;
  return { type: 'corp_roster', message: msg.trimEnd() };
}

async function cmdInvite(player, targetName, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.INVITE)) return err("You don't have permission to invite.");
  if (!targetName) return err('Invite whom? Usage: corp invite <player>');
  const target = findOnline(targetName);
  if (!target) return err(`No one online by the name "${esc(targetName)}".`);
  if (getPlayerMembership(target.id)) return err(`${esc(target.handle)} is already in a corp.`);
  const org = getOrg(m.org_id);
  const { rows: [icnt] } = await query('SELECT COUNT(*)::int n FROM org_members WHERE org_id=$1', [org.id]);
  if (icnt.n >= memberCap(org.tier)) return err(`Your corp is at its member cap (${memberCap(org.tier)} at tier ${tierCap(org.tier)}). Raise it with "corp invest".`);
  pendingInvites.set(target.id, { orgId: org.id, orgName: org.name, expiresAt: Date.now() + INVITE_TTL_MS });
  broadcast(null, { type: 'output', message: `<span class="msg-system">${esc(player.handle)} invites you to join ${esc(org.name)}. Type "corp accept" within 2 minutes.</span>` }, null, target.id);
  return { type: 'corp_invite', message: `You invite ${esc(target.handle)} to ${esc(org.name)}.` };
}

async function cmdAccept(player) {
  if (getPlayerMembership(player.id)) return err("You're already in a corp.");
  const inv = pendingInvites.get(player.id);
  if (!inv || inv.expiresAt < Date.now()) { pendingInvites.delete(player.id); return err('You have no pending corp invite.'); }
  const org = getOrg(inv.orgId);
  pendingInvites.delete(player.id);
  if (!org) return err('That corp no longer exists.');
  const { rows: [acnt] } = await query('SELECT COUNT(*)::int n FROM org_members WHERE org_id=$1', [org.id]);
  if (acnt.n >= memberCap(org.tier)) return err(`${esc(org.name)} is full (${memberCap(org.tier)} members at tier ${tierCap(org.tier)}).`);
  const defRank = org.ranks.find(r => r.is_default) || [...org.ranks].sort((a, b) => a.rank_order - b.rank_order)[0];
  if (!defRank) return err('That corp has no joinable rank.');
  await query('INSERT INTO org_members (org_id, player_id, rank_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [org.id, player.id, defRank.id]);
  await reloadOrg(org.id);
  return { type: 'corp_joined', message: `You join <b>${esc(org.name)}</b>.` };
}

async function cmdLeave(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const org = getOrg(m.org_id);
  if (org.owner_id === player.id) return err('You own this corp — use "corp disband" to dissolve it.');
  await query('DELETE FROM org_members WHERE org_id=$1 AND player_id=$2', [m.org_id, player.id]);
  await reloadOrg(m.org_id);
  return { type: 'corp_left', message: `You leave ${esc(org.name)}.` };
}

async function cmdKick(player, targetName) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.KICK)) return err("You don't have permission to kick.");
  if (!targetName) return err('Kick whom? Usage: corp kick <player>');
  const org = getOrg(m.org_id);
  const { rows } = await query(
    `SELECT om.player_id, p.handle, r.rank_order FROM org_members om
       JOIN players p ON p.id=om.player_id JOIN org_ranks r ON r.id=om.rank_id
      WHERE om.org_id=$1 AND LOWER(p.handle)=LOWER($2)`, [m.org_id, targetName]);
  if (!rows.length) return err(`No corp member named "${esc(targetName)}".`);
  const target = rows[0];
  if (target.player_id === player.id) return err('You can\'t kick yourself. Use "corp leave".');
  if (org.owner_id !== player.id && target.rank_order >= myRankOrder(org, m)) return err("You can't kick someone of equal or higher rank.");
  await query('DELETE FROM org_members WHERE org_id=$1 AND player_id=$2', [m.org_id, target.player_id]);
  await reloadOrg(m.org_id);
  return { type: 'corp_kick', message: `You kick ${esc(target.handle)} from ${esc(org.name)}.` };
}

async function cmdContribute(player, amountStr, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const amount = amountStr === 'all' ? (player.credits || 0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return err('Contribute how much? Usage: corp contribute <amount>');
  const ok = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -amount, q, 'corp:contribute')) return false;
    await q('UPDATE orgs SET treasury = treasury + $1 WHERE id=$2', [amount, m.org_id]);
    return true;
  });
  if (!ok) return err(`You only have ${player.credits || 0}c on you.`);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  return {
    type: 'corp_contribute',
    message: `You contribute ${amount}c to ${esc(getOrg(m.org_id).name)}. Treasury: ${getOrg(m.org_id).treasury}c.`,
    player_update: { credits: player.credits },
  };
}

async function cmdDisburse(player, targetName, amountStr, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.DISBURSE)) return err("You don't have permission to disburse funds.");
  const amount = parseInt(amountStr, 10);
  if (!targetName || !amount || amount <= 0) return err('Usage: corp disburse <player> <amount>');
  const { rows } = await query(
    `SELECT om.player_id, p.handle FROM org_members om JOIN players p ON p.id=om.player_id
      WHERE om.org_id=$1 AND LOWER(p.handle)=LOWER($2)`, [m.org_id, targetName]);
  if (!rows.length) return err(`No corp member named "${esc(targetName)}".`);
  const targetId = rows[0].player_id;
  const targetLive = liveById(targetId);

  const result = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury = treasury - $1 WHERE id=$2 AND treasury >= $1 RETURNING treasury', [amount, m.org_id]);
    if (!dec.rowCount) return null;
    if (targetLive) await adjustCredits(targetLive, amount, q, 'corp:disburse');
    else await q('UPDATE players SET credits = credits + $1 WHERE id=$2', [amount, targetId]);
    return { treasury: dec.rows[0].treasury };
  });
  if (!result) return err(`The treasury doesn't have ${amount}c.`);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  const org = getOrg(m.org_id);
  if (targetLive && targetLive.id !== player.id) {
    broadcast(null, { type: 'output', message: `<span class="msg-system">${esc(org.name)} disburses ${amount}c to you.</span>`, player_update: { credits: targetLive.credits } }, null, targetLive.id);
  }
  return {
    type: 'corp_withdraw',
    message: `You disburse ${amount}c to ${esc(rows[0].handle)}. Treasury: ${result.treasury}c.`,
    player_update: targetLive && targetLive.id === player.id ? { credits: player.credits } : undefined,
  };
}

async function cmdEdit(player, field, value) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.EDIT_CORP)) return err("You don't have permission to edit the corp.");
  field = (field || '').toLowerCase();
  value = (value || '').trim();
  if (field === 'name') {
    if (!value || value.length > MAX_NAME) return err(`Usage: corp edit name <new name> (≤ ${MAX_NAME} chars)`);
    if (getOrgByName(value) && getOrgByName(value).id !== m.org_id) return err(`A corp named "${esc(value)}" already exists.`);
    await query('UPDATE orgs SET name=$1 WHERE id=$2', [value, m.org_id]);
  } else if (field === 'desc' || field === 'description') {
    await query('UPDATE orgs SET description=$1 WHERE id=$2', [value.slice(0, 200), m.org_id]);
  } else if (field === 'color') {
    if (!isHex6(value)) return err('Usage: corp edit color #rrggbb');
    const hex = value.toLowerCase();
    // Any colour is allowed — corps may share hues (no distinctness gate).
    await query('UPDATE orgs SET color=$1 WHERE id=$2', [hex, m.org_id]);
  } else {
    return err('Usage: corp edit name|desc|color <value>');
  }
  await reloadOrg(m.org_id);
  return { type: 'corp_edit', message: `Corp ${field} updated.` };
}

async function cmdRank(player, rest) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const org = getOrg(m.org_id);
  const sub = (rest[0] || 'list').toLowerCase();

  if (sub === 'list') {
    let msg = `<span class="skills-header">${esc(org.name)} — RANKS</span>\n`;
    for (const r of [...org.ranks].sort((a, b) => b.rank_order - a.rank_order)) {
      msg += `  ${esc(r.name)} (order ${r.rank_order})${r.is_default ? ' [default]' : ''} — ${permLabel(r.permissions)}\n`;
    }
    return { type: 'corp_rank_update', message: msg.trimEnd() };
  }
  if (!hasPerm(player, PERM.EDIT_RANKS)) return err("You don't have permission to manage ranks.");

  if (sub === 'add') {
    const name = rest[1];
    const order = parseInt(rest[2], 10);
    if (!name || Number.isNaN(order)) return err('Usage: corp rank add <name> <order> <perm,perm|all|none>');
    if (order >= myRankOrder(org, m) && org.owner_id !== player.id) return err("You can't create a rank at or above your own.");
    if (org.ranks.some(r => r.name.toLowerCase() === name.toLowerCase())) return err(`A rank named "${esc(name)}" already exists.`);
    const { bits, bad } = parsePerms(rest.slice(3).join(','));
    if (bad.length) return err(`Unknown permission(s): ${esc(bad.join(', '))}. Valid: ${Object.keys(PERM_NAMES).join(', ')}, all, none.`);
    await query('INSERT INTO org_ranks (id, org_id, name, rank_order, permissions, is_default) VALUES ($1,$2,$3,$4,$5,0)',
      [randomUUID(), m.org_id, name, order, bits]);
    await reloadOrg(m.org_id);
    return { type: 'corp_rank_update', message: `Rank "${esc(name)}" created (order ${order}, ${permLabel(bits)}).` };
  }
  if (sub === 'set') {
    const name = rest[1];
    const rank = org.ranks.find(r => r.name.toLowerCase() === String(name || '').toLowerCase());
    if (!rank) return err(`No rank named "${esc(name)}". See "corp rank list".`);
    if (rank.rank_order >= myRankOrder(org, m) && org.owner_id !== player.id) return err("You can't edit a rank at or above your own.");
    const { bits, bad } = parsePerms(rest.slice(2).join(','));
    if (bad.length) return err(`Unknown permission(s): ${esc(bad.join(', '))}.`);
    await query('UPDATE org_ranks SET permissions=$1 WHERE id=$2', [bits, rank.id]);
    await reloadOrg(m.org_id);
    return { type: 'corp_rank_update', message: `Rank "${esc(rank.name)}" permissions set to ${permLabel(bits)}.` };
  }
  if (sub === 'del' || sub === 'delete') {
    const name = rest[1];
    const rank = org.ranks.find(r => r.name.toLowerCase() === String(name || '').toLowerCase());
    if (!rank) return err(`No rank named "${esc(name)}".`);
    if (rank.is_default) return err("You can't delete the default rank.");
    const { rows: [inUse] } = await query('SELECT COUNT(*)::int n FROM org_members WHERE rank_id=$1', [rank.id]);
    if (inUse.n > 0) return err(`That rank has ${inUse.n} member(s) — reassign them first.`);
    await query('DELETE FROM org_ranks WHERE id=$1', [rank.id]);
    await reloadOrg(m.org_id);
    return { type: 'corp_rank_update', message: `Rank "${esc(rank.name)}" deleted.` };
  }
  return err('Usage: corp rank list|add|set|del ...');
}

async function cmdSetRank(player, targetName, rankName) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.EDIT_RANKS)) return err("You don't have permission to manage ranks.");
  const org = getOrg(m.org_id);
  const rank = org.ranks.find(r => r.name.toLowerCase() === String(rankName || '').toLowerCase());
  if (!rank) return err(`No rank named "${esc(rankName)}". See "corp rank list".`);
  const mine = myRankOrder(org, m);
  if (org.owner_id !== player.id && rank.rank_order >= mine) return err("You can't assign a rank at or above your own.");
  const { rows } = await query(
    `SELECT om.player_id, p.handle, r.rank_order FROM org_members om
       JOIN players p ON p.id=om.player_id JOIN org_ranks r ON r.id=om.rank_id
      WHERE om.org_id=$1 AND LOWER(p.handle)=LOWER($2)`, [m.org_id, targetName]);
  if (!rows.length) return err(`No corp member named "${esc(targetName)}".`);
  const target = rows[0];
  if (target.player_id === org.owner_id) return err("You can't change the owner's rank.");
  if (org.owner_id !== player.id && target.rank_order >= mine) return err("You can't change the rank of someone at or above you.");
  await query('UPDATE org_members SET rank_id=$1 WHERE org_id=$2 AND player_id=$3', [rank.id, m.org_id, target.player_id]);
  await reloadOrg(m.org_id);
  return { type: 'corp_rank_update', message: `${esc(target.handle)} is now ${esc(rank.name)}.` };
}

// `corp claim` is context-sensitive: an apartment → HQ; a claimable zone → territory.
async function cmdClaim(player, broadcast) {
  const zone = getZone(player.current_zone);
  if (zone?.flags?.is_apartment) return cmdClaimHQ(player);
  if (isClaimableZone(zone)) return cmdClaimTerritory(player, broadcast);
  return err("Nothing to claim here — stand in a vacant apartment (HQ) or a contestable zone (territory).");
}

async function cmdClaimHQ(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.MANAGE_HQ)) return err("You don't have permission to claim an HQ.");
  const zone = getZone(player.current_zone);
  if (!zone?.flags?.is_apartment) return err("This isn't a claimable unit — find a vacant apartment.");
  const apt = getApartment(zone.id);
  if (apt?.owner_id) {
    if (apt.owner_type === 'org' && apt.owner_org_id === m.org_id) return err('Your corp already holds this HQ.');
    return err('This unit is already owned.');
  }
  const org = getOrg(m.org_id);
  if ((org.treasury || 0) < HQ_FEE) return err(`Claiming an HQ costs ${HQ_FEE}c from the treasury — it has ${org.treasury || 0}c.`);
  const now = Math.floor(Date.now() / 1000);
  const buildingName = zone.flags?.building_name || zone.name;

  const result = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury = treasury - $1 WHERE id=$2 AND treasury >= $1 RETURNING treasury', [HQ_FEE, org.id]);
    if (!dec.rowCount) return null;
    const upd = await q(
      `INSERT INTO apartments (zone_id, owner_id, owner_handle, owner_type, owner_org_id, is_locked, lock_difficulty, rent_cost, purchased_at, date_rented, building_name)
       VALUES ($1,$2,$3,'org',$2,0,$4,$5,$6,$6,$7)
       ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, owner_type='org', owner_org_id=$2, is_locked=0, lock_difficulty=$4, purchased_at=$6, date_rented=$6, building_name=$7
       RETURNING *`,
      [zone.id, org.id, org.name, HQ_LOCK_DIFFICULTY, HQ_FEE, now, buildingName]);
    return { treasury: dec.rows[0].treasury, apt: upd.rows[0] };
  });
  if (!result) return err(`The treasury doesn't have ${HQ_FEE}c.`);
  setApartmentCache(zone.id, result.apt);
  await ensureCorpTerminal(zone.id);
  await reloadOrg(org.id);
  return { type: 'corp_hq_claim', message: `<b>${esc(org.name)}</b> claims this unit as its HQ for ${HQ_FEE}c. A corp ops terminal boots against the wall — <b>use</b> it (or type <b>corp</b>) to open the console. Treasury: ${result.treasury}c.` };
}

async function cmdClaimTerritory(player, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.MANAGE_HQ)) return err("You don't have permission to claim territory.");
  const zone = getZone(player.current_zone);
  const zc = getZoneControl(zone.id);
  if (zc?.org_id) {
    if (zc.org_id === m.org_id) return err("Your corp already controls this zone — 'corp reinforce' to strengthen your grip.");
    return err(`Held by a rival (grip ${zc.influence}%). Break it with 'corp contest'.`);
  }
  const org = getOrg(m.org_id);
  const held = getOrgZones(m.org_id).length;
  if (held >= territorySlots(org.tier)) return err(`Your corp holds its max ${territorySlots(org.tier)} zone(s) at tier ${tierCap(org.tier)}. Expand with "corp invest".`);
  if ((org.treasury || 0) < TERRITORY_CLAIM_FEE) return err(`Claiming territory costs ${TERRITORY_CLAIM_FEE}c from the treasury — it has ${org.treasury || 0}c.`);
  const now = Math.floor(Date.now() / 1000);
  const res = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury=treasury-$1 WHERE id=$2 AND treasury>=$1 RETURNING treasury', [TERRITORY_CLAIM_FEE, org.id]);
    if (!dec.rowCount) return null;
    const row = await q(
      `INSERT INTO zone_control (zone_id, org_id, influence, challenger_org_id, captured_at)
         VALUES ($1,$2,$3,NULL,$4)
       ON CONFLICT (zone_id) DO UPDATE SET org_id=$2, influence=$3, challenger_org_id=NULL, captured_at=$4
       RETURNING *`, [zone.id, org.id, START_INFLUENCE, now]);
    return { treasury: dec.rows[0].treasury, row: row.rows[0] };
  });
  if (!res) return err(`The treasury doesn't have ${TERRITORY_CLAIM_FEE}c.`);
  setZoneControlCache(zone.id, res.row);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  broadcast?.(player.current_zone, { type: 'zone_event', message: `<span class="msg-system">${esc(org.name)} raises its colours over ${esc(zone.name)}.</span>` }, player.id);
  return { type: 'corp_territory', message: `<b>${esc(org.name)}</b> claims <b>${esc(zone.name)}</b>. Grip ${START_INFLUENCE}% · +${res.row.base_income}/day income.` };
}

async function cmdContest(player, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const zone = getZone(player.current_zone);
  if (!isClaimableZone(zone)) return err("There's no territory to contest here.");
  const zc = getZoneControl(zone.id);
  if (!zc || !zc.org_id) return err("This zone is unclaimed — take it with 'corp claim'.");
  if (zc.org_id === m.org_id) return err("Your corp already holds this zone.");
  const until = contestCooldown.get(player.id) || 0;
  if (Date.now() < until) return err(`You need to regroup before pushing again. (${Math.ceil((until - Date.now()) / 1000)}s)`);
  contestCooldown.set(player.id, Date.now() + CONTEST_COOLDOWN_MS);

  const difficulty = 5 + Math.floor(zc.influence / 20);
  const check = await skillCheck(player, 'intimidate', difficulty);
  if (!check.success) {
    return { type: 'corp_territory', message: `You push against the hold on <b>${esc(zone.name)}</b> but make no headway. (${check.effective} vs ${check.difficulty})` };
  }
  await awardSkillUse(player.id, 'intimidate', check.margin);
  const rawErosion = Math.max(4, 8 + check.margin * 2);
  const defense = zoneDefense(zone.id);            // turrets soak the assault
  const erosion = Math.max(1, rawErosion - defense);
  const absorbed = rawErosion - erosion;
  const now = Math.floor(Date.now() / 1000);
  const res = await withTransaction(async (q) => {
    const cur = await q('SELECT * FROM zone_control WHERE zone_id=$1 FOR UPDATE', [zone.id]);
    const row0 = cur.rows[0];
    if (!row0 || !row0.org_id || row0.org_id === m.org_id) return { noop: true };
    if (row0.influence - erosion <= 0) {
      const flipped = await q('UPDATE zone_control SET org_id=$1, influence=$2, challenger_org_id=NULL, captured_at=$3 WHERE zone_id=$4 RETURNING *',
        [m.org_id, START_INFLUENCE, now, zone.id]);
      return { row: flipped.rows[0], flipped: true, prevOrg: row0.org_id };
    }
    const upd = await q('UPDATE zone_control SET influence=$1, challenger_org_id=$2 WHERE zone_id=$3 RETURNING *',
      [row0.influence - erosion, m.org_id, zone.id]);
    return { row: upd.rows[0], flipped: false };
  });
  if (res.noop) return err("Control of the zone just shifted — try again.");
  setZoneControlCache(zone.id, res.row);
  await pushConsole(m.org_id, broadcast);
  if (res.prevOrg) await pushConsole(res.prevOrg, broadcast);
  const org = getOrg(m.org_id);
  if (res.flipped) {
    broadcast?.(player.current_zone, { type: 'zone_event', message: `<span class="msg-system">${esc(org.name)} seizes ${esc(zone.name)}!</span>` }, player.id);
    return { type: 'corp_territory', message: `<b>${esc(org.name)}</b> breaks the last hold and <b>seizes ${esc(zone.name)}</b>! Grip ${res.row.influence}%.` };
  }
  const defNote = absorbed > 0 ? ` <span class="dim">(turrets soaked ${absorbed})</span>` : '';
  return { type: 'corp_territory', message: `You erode the hold on <b>${esc(zone.name)}</b> — grip down to ${res.row.influence}%.${defNote} Keep the pressure on.` };
}

async function cmdReinforce(player, amountStr, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.MANAGE_HQ)) return err("You don't have permission to reinforce territory.");
  const zone = getZone(player.current_zone);
  const zc = getZoneControl(zone?.id);
  if (!zc || zc.org_id !== m.org_id) return err("Your corp doesn't control this zone.");
  if (zc.influence >= 100) return err("Your grip here is already absolute (100%).");
  const want = amountStr ? Math.max(1, parseInt(amountStr, 10) || 0) : 10;
  const points = Math.min(want, 100 - zc.influence);
  const cost = points * REINFORCE_COST;
  const org = getOrg(m.org_id);
  if ((org.treasury || 0) < cost) return err(`Reinforcing +${points}% costs ${cost}c — the treasury has ${org.treasury || 0}c.`);
  const res = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury=treasury-$1 WHERE id=$2 AND treasury>=$1 RETURNING treasury', [cost, org.id]);
    if (!dec.rowCount) return null;
    const row = await q('UPDATE zone_control SET influence=LEAST(100, influence+$1) WHERE zone_id=$2 RETURNING *', [points, zone.id]);
    return { treasury: dec.rows[0].treasury, row: row.rows[0] };
  });
  if (!res) return err(`The treasury doesn't have ${cost}c.`);
  setZoneControlCache(zone.id, res.row);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  return { type: 'corp_territory', message: `You pour ${cost}c into holding <b>${esc(zone.name)}</b>. Grip ${res.row.influence}%.` };
}

// Phase 2 — invest treasury to raise the corp's tier (member cap / territory
// slots / asset level cap all scale with it).
async function cmdInvest(player, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.EDIT_CORP)) return err("You don't have permission to invest in the corp.");
  const org = getOrg(m.org_id);
  const tier = tierCap(org.tier);
  if (tier >= MAX_TIER) return err(`Your corp is already at the top tier (${MAX_TIER}).`);
  const cost = TIER_COST[tier + 1];
  if ((org.treasury || 0) < cost) return err(`Advancing to tier ${tier + 1} costs ${cost}c — the treasury has ${org.treasury || 0}c.`);
  const res = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury=treasury-$1, tier=tier+1 WHERE id=$2 AND treasury>=$1 AND tier=$3 RETURNING treasury, tier', [cost, org.id, tier]);
    return dec.rowCount ? dec.rows[0] : null;
  });
  if (!res) return err(`The treasury doesn't have ${cost}c.`);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  return { type: 'corp_invest', message: `<b>${esc(org.name)}</b> advances to <b>Tier ${res.tier}</b> for ${cost}c. Member cap ${memberCap(res.tier)} · ${territorySlots(res.tier)} territory slots · assets to level ${res.tier}. Treasury: ${res.treasury}c.` };
}

// Phase 2 — build/upgrade an asset (extractor/turret) on a controlled zone.
async function cmdBuild(player, typeArg, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.MANAGE_HQ)) return err("You don't have permission to build here.");
  const type = String(typeArg || '').toLowerCase();
  const def = ASSETS[type];
  if (!def) return err('Build what? Usage: corp build extractor|turret');
  const zone = getZone(player.current_zone);
  const zc = getZoneControl(zone?.id);
  if (!zc || zc.org_id !== m.org_id) return err("Your corp must control this zone to build here.");
  const org = getOrg(m.org_id);
  const tier = tierCap(org.tier);
  const existing = getZoneAssets(zone.id).find(a => a.type === type);
  const curLevel = existing?.level || 0;
  if (curLevel >= tier) return err(`Your ${def.label.toLowerCase()} here is at your tier cap (level ${tier}). Raise it with "corp invest".`);
  const newLevel = curLevel + 1;
  const cost = def.base + curLevel * def.perLevel;
  if ((org.treasury || 0) < cost) return err(`${curLevel ? 'Upgrading' : 'Building'} a ${def.label.toLowerCase()} costs ${cost}c — the treasury has ${org.treasury || 0}c.`);
  const treasury = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury=treasury-$1 WHERE id=$2 AND treasury>=$1 RETURNING treasury', [cost, org.id]);
    if (!dec.rowCount) return null;
    if (existing) await q('UPDATE org_assets SET level=$1 WHERE id=$2', [newLevel, existing.id]);
    else await q('INSERT INTO org_assets (id, org_id, zone_id, type, level) VALUES ($1,$2,$3,$4,1)', [randomUUID(), org.id, zone.id, type]);
    return dec.rows[0].treasury;
  });
  if (treasury == null) return err(`The treasury doesn't have ${cost}c.`);
  await reloadZoneAssets(zone.id);
  await reloadOrg(m.org_id);
  await pushConsole(m.org_id, broadcast);
  const effect = type === 'extractor' ? `+${newLevel * def.income}/day income` : `+${newLevel * def.defense} defence`;
  return { type: 'corp_territory', message: `${curLevel ? 'You upgrade the' : 'You build a'} <b>${def.label}</b> in <b>${esc(zone.name)}</b> to level ${newLevel} — ${effect}. Treasury: ${treasury}c.` };
}

// 24h territory tick: settle income − upkeep to each controller's treasury, and
// drift grip (uncontested consolidates toward 100; contested erodes toward a flip).
async function runTerritoryTick() {
  const rows = getAllZoneControl().filter(z => z.org_id);
  const net = new Map();
  for (const z of rows) {
    // Extractors add income; turrets blunt the daily erosion of a contested zone.
    const income = (z.base_income || 0) + zoneExtractorIncome(z.zone_id);
    net.set(z.org_id, (net.get(z.org_id) || 0) + income - (z.base_upkeep || 0));
    const erode = Math.max(1, ERODE_PER_DAY - zoneDefense(z.zone_id));
    let inf = z.challenger_org_id ? z.influence - erode : Math.min(100, z.influence + CONSOLIDATE_PER_DAY);
    if (inf <= 0 && z.challenger_org_id) {
      const now = Math.floor(Date.now() / 1000);
      await query('UPDATE zone_control SET org_id=$1, influence=$2, challenger_org_id=NULL, captured_at=$3 WHERE zone_id=$4', [z.challenger_org_id, START_INFLUENCE, now, z.zone_id]);
    } else if (inf !== z.influence) {
      await query('UPDATE zone_control SET influence=$1 WHERE zone_id=$2', [Math.max(0, inf), z.zone_id]);
    }
  }
  for (const [orgId, delta] of net) {
    if (delta > 0) await query('UPDATE orgs SET treasury=treasury+$1 WHERE id=$2', [delta, orgId]);
    else if (delta < 0) await query('UPDATE orgs SET treasury=GREATEST(0, treasury+$1) WHERE id=$2', [delta, orgId]);
  }
  for (const z of rows) {
    const { rows: r } = await query('SELECT * FROM zone_control WHERE zone_id=$1', [z.zone_id]);
    setZoneControlCache(z.zone_id, r[0] || null);
  }
  for (const orgId of net.keys()) await reloadOrg(orgId);
  if (rows.length) console.log(`[corps] Territory tick: ${rows.length} zone(s), ${net.size} org(s) settled.`);
}

// Every claimed HQ gets a wall-mounted ops terminal (idempotent) — the diegetic
// entry to the console; `use` it (doUseCorpTerminal) to open it.
async function ensureCorpTerminal(zoneId) {
  const { rows } = await query(`SELECT 1 FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'corp_terminal') LIMIT 1`, [zoneId]);
  if (rows.length) return;
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type, origin)
       VALUES ($1,$2,$3,$4,$5,'terminal','player')`,
    [randomUUID(), zoneId, 'corp ops terminal',
     'A wall-mounted command terminal, its screen aglow with the corp sigil. USE it to open the ops console.',
     JSON.stringify({ corp_terminal: true, interactions: ['use'] })]);
}

async function cmdDisband(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const org = getOrg(m.org_id);
  if (org.owner_id !== player.id && !hasPerm(player, PERM.DISBAND)) return err('Only the owner (or a rank with disband) can dissolve the corp.');

  // Release any HQ apartments first (clears ownership + unlocks the door + syncs cache),
  // and remove the ops terminal so a vacated unit isn't left with a dead console.
  const { rows: hqRows } = await query('SELECT zone_id FROM apartments WHERE owner_org_id=$1', [org.id]);
  for (const h of hqRows) {
    await releaseCorpHq(h.zone_id);
    await query(`DELETE FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'corp_terminal')`, [h.zone_id]);
  }

  await withTransaction(async (q) => {
    if ((org.treasury || 0) > 0 && org.owner_id) {
      const ownerLive = liveById(org.owner_id);
      if (ownerLive) await adjustCredits(ownerLive, org.treasury, q, 'corp:disband');
      else await q('UPDATE players SET credits = credits + $1 WHERE id=$2', [org.treasury, org.owner_id]);
    }
    await q('DELETE FROM orgs WHERE id=$1', [org.id]); // CASCADE ranks/members/relations
  });
  removeOrgFromCache(org.id);
  return {
    type: 'corp_disband',
    message: `You dissolve <b>${esc(org.name)}</b>. Treasury refunded to the owner; any HQ released.`,
    player_update: org.owner_id === player.id ? { credits: player.credits } : undefined,
  };
}

async function cmdSay(player, text, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  text = (text || '').trim();
  if (!text) return err('Say what? Usage: corp say <message>');
  sendToChatChannel(`#corp:${m.org_id}`, { type: 'channel_msg', channel: `#corp:${m.org_id}`, from: player.handle, message: text }, broadcast);
  return null;
}

const USAGE = [
  '<span class="skills-header">CORP</span>',
  'corp                      — your corp info',
  'corp found <name>         — found a corp (costs ' + FOUND_FEE + 'c)',
  'corp roster               — list members',
  'corp invite <player>      — invite an online player',
  'corp accept               — accept a pending invite',
  'corp leave                — leave your corp',
  'corp kick <player>        — remove a member',
  'corp contribute <amount>  — add credits to the treasury',
  'corp disburse <player> <amount> — pay a member from the treasury',
  'corp rank list|add|set|del ...  — manage ranks',
  'corp setrank <player> <rank>    — assign a member\'s rank',
  'corp edit name|desc|color <value>',
  'corp claim                — claim where you stand (apartment → HQ ' + HQ_FEE + 'c; zone → territory ' + TERRITORY_CLAIM_FEE + 'c)',
  'corp contest              — erode a rival\'s grip on this zone (seize it at 0%)',
  'corp reinforce [pts]      — spend treasury to strengthen your grip here',
  'corp invest               — raise your corp tier (member cap · territory slots · assets)',
  'corp build extractor|turret — build/upgrade an asset on a zone you hold',
  'corp say <message>        — talk on your private corp channel',
  'corp disband              — dissolve the corp (owner only)',
].join('\n');

// ─── Dispatcher ───────────────────────────────────────────────────────────

async function cmdCorp(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  // `args`/`rest` come pre-lowercased from the command dispatcher (it lowercases
  // the whole line to parse verbs). Free-text arguments — corp names, edit
  // values, chat — must keep the player's original casing, so re-derive them
  // from `raw` (same split, positionally aligned with `args` since only case
  // differs) instead of `rest`.
  const rawRest = raw.trim().split(/\s+/).slice(2);
  switch (sub) {
    case '':
    case 'console':     return buildConsolePayload(player);
    case 'help':        return { type: 'output', message: USAGE };
    case 'found':       return cmdFound(player, rawRest.join(' '));
    case 'info':        return cmdInfo(player);
    case 'roster':
    case 'who':         return cmdRoster(player);
    case 'invite':      return cmdInvite(player, rest[0], broadcast);
    case 'accept':
    case 'join':        return cmdAccept(player);
    case 'leave':       return cmdLeave(player);
    case 'kick':        return cmdKick(player, rest[0]);
    case 'contribute':
    case 'deposit':     return cmdContribute(player, rest[0], broadcast);
    case 'disburse':
    case 'withdraw':    return cmdDisburse(player, rest[0], rest[1], broadcast);
    case 'edit':        return cmdEdit(player, rest[0], rawRest.slice(1).join(' '));
    case 'rank':        return cmdRank(player, rest);
    case 'setrank':
    case 'promote':     return cmdSetRank(player, rest[0], rest[1]);
    case 'claim':       return cmdClaim(player, broadcast);
    case 'map':         return cmdCorpMap(player);
    case 'territory':   return cmdCorpTerritory(player); // big-map overlay layer (client-internal)
    case 'contest':
    case 'raid':        return cmdContest(player, broadcast);
    case 'reinforce':
    case 'fortify':     return cmdReinforce(player, rest[0], broadcast);
    case 'invest':      return cmdInvest(player, broadcast);
    case 'build':       return cmdBuild(player, rest[0], broadcast);
    case 'say':
    case 'chat':        return cmdSay(player, rawRest.join(' '), broadcast);
    case 'disband':     return cmdDisband(player);
    default:            return err(`Unknown corp command "${esc(sub)}". Try "corp help".`);
  }
}

// Diegetic entry: `use` an HQ terminal (furniture tagged `corp_terminal`) boots
// the console, mirroring the ATM's `{verb:'use', requiredTag:'atm'}`. Self-resolves
// its target (the specialized-action registry fires this on every `use`), so it
// falls through when there's no terminal here. Bound to the HQ's owning corp.
async function doUseCorpTerminal(args, raw, player) {
  const hint = (args.join(' ') || '').trim();
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'corp_terminal')` +
    (hint ? ' AND name ILIKE $2' : '') + ' LIMIT 1',
    hint ? [player.current_zone, `%${hint}%`] : [player.current_zone]);
  if (!rows.length) return undefined; // no corp terminal here — fall through
  const m = getPlayerMembership(player.id);
  if (!m) return err('The terminal blinks: CORP CREDENTIALS REQUIRED.');
  const apt = getApartment(player.current_zone);
  if (apt?.owner_type === 'org' && apt.owner_org_id && apt.owner_org_id !== m.org_id) {
    return err('ACCESS DENIED — this terminal is bound to another corporation.');
  }
  return buildConsolePayload(player);
}

export const commands = {
  corp: cmdCorp,
  org: cmdCorp,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'corp_terminal', handler: doUseCorpTerminal },
];

// ── Corp recruitment posters ─────────────────────────────────────────────────
// Furniture flagged `corp_poster` (placed near spawn — see scripts/seed-corp-posters.mjs)
// carries the eye-catching Franchise-style propaganda in its own description. THIS
// hook adds only the *ache* the poster is engineered to leave behind and a lead to
// a person — deliberately NO command list. Learning how a corp actually works is a
// conversation you have with Denny Corliss down at the Yards (scripts/add-corp-recruiter.js),
// not fine print you read off a wall. A few posters (`architect_wink`) carry the
// license motif that only pays off once you learn what corps really serve.
// Returns undefined for any other furniture so the posters plugin's own
// `furniture.describe` still runs (last non-undefined wins).
export const _corpPosterPitch = (f) => {
  if (f?.flags?.corp_poster !== true) return undefined;
  let out =
    `<span class="text-dim">There's no form on it, no number to call — just the want it's built to leave in you, and, in a corner, a line small enough to feel like a secret: <b>Sign-ups in person only.</b> Ask down at the Yards. Word on the row is a smiling man named <b>Denny Corliss</b> keeps a folding table at the Depot, just inside the gates, and will walk anyone who asks through starting an outfit of their own.</span>`;
  if (f.flags?.architect_wink === true) {
    out += `\n<span class="text-dim">Bottom corner, too small to be meant for you: "OPERATING UNDER LICENSE · NORTHERN ACCESS GRANTED WHERE PRODUCTIVITY IS OBSERVED · —A"</span>`;
  }
  return out;
};

export const hooks = {
  'furniture.describe': (f) => _corpPosterPitch(f),
};

// Exported for tests/ops (the verify harness drives it without waiting 24h).
export { runTerritoryTick };
export { colorDistance, MIN_COLOR_DISTANCE, FOUND_FEE };

// Exported for the Tablet OS Corporation app (plugins/tablet/corp-app.js) —
// same payload the `corp console` command itself returns, reused rather than
// rebuilt so the two surfaces can never drift. cmdCorpMap likewise powers the
// Tablet's Territory Map sub-screen (same tiles the `corp map` overlay uses).
export { buildConsolePayload, cmdCorpMap };

// Settle territory income/upkeep + grip drift once a day.
schedule('24h', () => runTerritoryTick().catch(e => console.error('[corps] territory tick error:', e.message)));

console.log('[corps] Plugin loaded.');
