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
  getAllLivePlayers, getZone, getApartment, setApartmentCache,
} from '../../server/engine/world.js';
import { PERM, PERM_ALL, hasPerm } from '../../server/engine/org-perms.js';
import { releaseCorpHq } from '../../server/engine/apartments.js';
import { sendToChatChannel } from '../../server/engine/channels.js';

const FOUND_FEE = 1000;            // credits to found a corp
const HQ_FEE = 500;                // credits (from treasury) to claim an HQ
const HQ_LOCK_DIFFICULTY = 4;      // matches apartments' base
const INVITE_TTL_MS = 120000;      // 2 minutes
const MAX_NAME = 40;

// targetPlayerId -> { orgId, orgName, expiresAt }
const pendingInvites = new Map();

const PERM_NAMES = {
  invite: PERM.INVITE, kick: PERM.KICK, edit_ranks: PERM.EDIT_RANKS,
  disburse: PERM.DISBURSE, edit_corp: PERM.EDIT_CORP, manage_hq: PERM.MANAGE_HQ,
  disband: PERM.DISBAND,
};

const err = (message) => ({ type: 'error', message });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  // Territory: HQ zones only until Phase 1 (no influence contest yet).
  const { rows: hqRows } = await query('SELECT zone_id FROM apartments WHERE owner_org_id = $1', [m.org_id]);
  const territory = hqRows.map(h => ({ zone: getZone(h.zone_id)?.name || h.zone_id, status: 'HQ', influence: 1 }));

  return {
    type: 'corp_console',
    accent: org.color || '#35e0c8',
    org: { name: org.name, tag: deriveTag(org), tier: org.flags?.tier || 1 },
    you: { rank: myRank?.name || '—', permissions: m.permissions },
    treasury: { balance: org.treasury || 0, income: 0, upkeep: 0 },
    members,
    relations,
    territory,
    directives: [],
    architectHeat: 0,
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
      broadcast(null, { type: 'corp_console_patch', treasury: payload.treasury, architectHeat: payload.architectHeat, members: payload.members }, null, p.id);
    }
  }
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
    if (!await adjustCredits(player, -FOUND_FEE, q)) return false;
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
    if (!await adjustCredits(player, -amount, q)) return false;
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
    if (targetLive) await adjustCredits(targetLive, amount, q);
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
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return err('Usage: corp edit color #rrggbb');
    await query('UPDATE orgs SET color=$1 WHERE id=$2', [value, m.org_id]);
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

async function cmdClaim(player) {
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

// Every claimed HQ gets a wall-mounted ops terminal (idempotent) — the diegetic
// entry to the console; `use` it (doUseCorpTerminal) to open it.
async function ensureCorpTerminal(zoneId) {
  const { rows } = await query(`SELECT 1 FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'corp_terminal') LIMIT 1`, [zoneId]);
  if (rows.length) return;
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
       VALUES ($1,$2,$3,$4,$5,'terminal')`,
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
      if (ownerLive) await adjustCredits(ownerLive, org.treasury, q);
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
  'corp claim                — claim this apartment as HQ (costs ' + HQ_FEE + 'c from treasury)',
  'corp say <message>        — talk on your private corp channel',
  'corp disband              — dissolve the corp (owner only)',
].join('\n');

// ─── Dispatcher ───────────────────────────────────────────────────────────

async function cmdCorp(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  switch (sub) {
    case '':
    case 'console':     return buildConsolePayload(player);
    case 'help':        return { type: 'output', message: USAGE };
    case 'found':       return cmdFound(player, rest.join(' '));
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
    case 'edit':        return cmdEdit(player, rest[0], rest.slice(1).join(' '));
    case 'rank':        return cmdRank(player, rest);
    case 'setrank':
    case 'promote':     return cmdSetRank(player, rest[0], rest[1]);
    case 'claim':       return cmdClaim(player);
    case 'say':
    case 'chat':        return cmdSay(player, rest.join(' '), broadcast);
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

console.log('[corps] Plugin loaded.');
