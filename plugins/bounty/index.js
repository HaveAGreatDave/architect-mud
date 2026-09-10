// BOUNTIES — a player puts their own money on another player's head, and
// somebody else has to bring the head in to collect it.
//
// ── The four decisions this plugin is built out of ────────────────────────────
//
// 1. THE HEAD IS A PHYSICAL OBJECT, AND THAT IS THE WHOLE SYSTEM.
//    A bounty does not pay the killer. It pays WHOEVER WALKS UP TO A BOARD
//    HOLDING THE HEAD. The head drops into the victim's corpse like any other
//    loot, which means it can be looted by a third party, stolen out of a
//    backpack, dropped, traded, or taken off the hunter by somebody who was
//    waiting outside. Every one of those is a story, and none of them needed a
//    line of code here — they are the inventory system, which is exactly why
//    the head is an item and not a flag. An auto-payout on death would have been
//    four lines and would have deleted all of it.
//
// 2. MONEY IS ESCROWED, AND NEVER SILENTLY DESTROYED.
//    The stake leaves the backer's pocket at posting and lives on the `bounties`
//    row until it is paid, refunded or forfeited. A restart cannot lose it and
//    cannot pay it twice. The only credits that ever vanish are the house cut,
//    which is disclosed before you confirm.
//
// 3. THE SHEET NAMES NOBODY.
//    Anonymity is the default because a bounty you have to sign is a declaration
//    of war, and most people would simply never post one. The target can PAY to
//    un-mask their backer — which turns a bounty from a thing done to you into a
//    thing you can answer, and gives the money a second place to go.
//
// 4. IT EXPIRES, AND THE REFUND IS REAL.
//    A target who takes a week off is not a target the system should keep
//    punishing, and an escrow that sits forever is money removed from the
//    economy. Expiry refunds the stake in full (the cut was spent at posting);
//    an early withdrawal costs a further penalty, so a bounty is not a threat
//    you can wave around for free.
//
// ── Accessibility ─────────────────────────────────────────────────────────────
// Every surface here is TEXT FIRST. `poster.js` builds the sheet as characters,
// and that block is what goes to the log — at EVERY rung, not only the bottom
// one. The client panel is a skin over the identical lines (the "suppress" shape
// in docs/systems-display-mode.md: the record always reaches the log, so the
// panel is free to be pure theatre and free to be switched off). Reward size is
// carried by a numeral AND a band word, never by type size or colour; the
// "this one is you" marker is a glyph as well as a hue.
//
// ── Cost ──────────────────────────────────────────────────────────────────────
// No tick reads the DB. `openBounties` is an in-memory mirror of the open rows,
// loaded once at boot and written through by the four mutators here (this plugin
// is the table's ONLY runtime writer, which is what makes a write-through mirror
// safe — see the funnel rule in CLAUDE.md). The expiry sweep is a 5-minute
// idle-gated scheduler pass over that Map. A player's death path asks the Map,
// not Postgres.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { on } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getLivePlayer, getAllLivePlayers, getZoneFurniture } from '../../server/engine/world.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { hasTag } from '../../server/engine/tags.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { escAttr } from '../../server/engine/text.js';
import { buildPoster, posterBlock, posterRow, money, listOf, escHtml } from './poster.js';
import { receptacleOf, line as recLine } from './receptacle.js';
import './tablet-app.js';

// ── tunables ──────────────────────────────────────────────────────────────────
export const MIN_BOUNTY = 250;          // below this it is an insult, not a contract
export const HOUSE_CUT = 0.10;          // taken at posting, never refunded
export const WITHDRAW_PENALTY = 0.25;   // of the escrow, if you pull it early
export const UNMASK_COST = 0.25;        // of the escrow, paid by the target to learn who
export const DURATION_DAYS = 7;         // real days the sheet stays up
const DURATION_MS = DURATION_DAYS * 86_400_000;
const HEAD_ITEM = 'item_bounty_head';

// The board tag. `wanted_board` furniture is where money changes hands; a plain
// `bulletin` board (the leaderboard) also carries sheets, because a board in a
// world with two kinds of board is a board players will stand at the wrong one of.
const BOARD_TAGS = ['wanted_board', 'bulletin'];

// A board is a MACHINE — a coin slot and a thermal printer on the way in, a
// receptacle and a scale on the way out — so it needs power like any other one.
// Paper is still paper, though: READING a board never checks this, because the
// sheets stay stapled to it when the lights go out. Only the two operations that
// need the machinery to move are gated.
//
// Zones with no generator assigned are absent from the map and treated as
// powered, which is the same reading plugins/atm uses.
function boardPowered(zoneId) {
  const z = getPowerMap().find(e => e.zoneId === zoneId);
  return !z || z.status === 'powered' || z.status === 'overloaded';
}

// ── in-memory mirror of the open rows ─────────────────────────────────────────
const openBounties = new Map();          // id -> row
const byTarget = new Map();              // targetId -> Set<id>

function index(row) {
  openBounties.set(row.id, row);
  if (!byTarget.has(row.target_id)) byTarget.set(row.target_id, new Set());
  byTarget.get(row.target_id).add(row.id);
}
function unindex(id) {
  const row = openBounties.get(id);
  if (!row) return;
  openBounties.delete(id);
  const set = byTarget.get(row.target_id);
  if (set) { set.delete(id); if (!set.size) byTarget.delete(row.target_id); }
}
export function bountiesOn(targetId) {
  return [...(byTarget.get(String(targetId)) || [])].map(id => openBounties.get(id)).filter(Boolean);
}
export function totalOn(targetId) {
  return bountiesOn(targetId).reduce((a, b) => a + (Number(b.amount) || 0), 0);
}
export function openList() {
  return [...openBounties.values()].sort((a, b) => b.amount - a.amount);
}

export async function loadBounties() {
  const { rows } = await query(`SELECT * FROM bounties WHERE status='open'`).catch(() => ({ rows: [] }));
  openBounties.clear(); byTarget.clear();
  for (const r of rows) index(r);
  if (rows.length) console.log(`[bounty] ${rows.length} open contract(s) loaded.`);
}
loadBounties().catch(() => {});

// ── boards ────────────────────────────────────────────────────────────────────
// A board is furniture, and the room's furniture is already in memory — this was
// a round trip on every bounty verb to ask what is standing in the room.
// Words that mean "the thing in this room that does bounties" rather than naming
// a particular one. A player typing `read board` at a machine called a bounty
// terminal is not being ambiguous, and making them get the furniture name right
// would be the room punishing them for a rename nobody told them about.
const GENERIC_NOUNS = new Set([
  'board', 'boards', 'terminal', 'bounty terminal', 'wanted board', 'bounty board',
  'machine', 'kiosk', 'bounty', 'wanted', 'sheet', 'sheets', 'contracts',
]);

function boardHere(zoneId, name = '') {
  const raw = String(name || '').trim().toLowerCase();
  const needle = GENERIC_NOUNS.has(raw) ? '' : raw;
  return getZoneFurniture(zoneId).find(f =>
    (!needle || (f.name || '').toLowerCase().includes(needle)) &&
    BOARD_TAGS.some(t => hasTag(f, t))
  ) || null;
}
// A clickable link for a bounty SUBCOMMAND. teachVerb builds its label as
// `${verb} ${target}`, which for a subcommand would read "bounty cancel cancel" —
// so the link is built here instead, with the visible text and the tooltip
// agreeing. Same markup contract (`action-link verb-teach` + data-action/target),
// so it still shimmers as a first-mention verb teach.
const sub = (word) =>
  `<span class="action-link verb-teach" data-action="bounty" data-target="${escAttr(word)}" title="bounty ${escAttr(word)}">bounty ${word}</span>`;

const NO_BOARD = `You need to be standing at a board for that. Contracts are posted and paid at a board — that's the only part of this business anybody insists on.`;

// ── posting ───────────────────────────────────────────────────────────────────

// Resolve a target by handle. Deliberately NOT SIFT: SIFT resolves what is in
// the room, and the entire point of a bounty is that the target is somewhere
// else. It must also resolve a player who is offline, because "log off and the
// contract cannot be written" is a loophole the whole feature dies of.
async function resolveTarget(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  const live = getAllLivePlayers().find(p => p.handle.toLowerCase() === t.toLowerCase());
  if (live) return { id: live.id, handle: live.handle };
  const { rows } = await query(
    `SELECT id, handle FROM players WHERE LOWER(handle)=LOWER($1) LIMIT 1`, [t]);
  if (rows[0]) return rows[0];
  const { rows: fuzzy } = await query(
    `SELECT id, handle FROM players WHERE handle ILIKE $1 ORDER BY LENGTH(handle) LIMIT 2`, [`%${t}%`]);
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

async function postBounty(player, targetName, amount, note, broadcast) {
  const board = boardHere(player.current_zone);
  if (!board) return { type: 'error', message: NO_BOARD };
  // A sheet has to be printed before it can be stapled up.
  if (!boardPowered(player.current_zone))
    return { type: 'error', message: recLine(receptacleOf(board), 'darkPost') };

  if (!Number.isFinite(amount) || amount < MIN_BOUNTY)
    return { type: 'error', message: `The minimum contract is ${money(MIN_BOUNTY)}. Anything less and nobody crosses the street for it.` };

  const target = await resolveTarget(targetName);
  if (!target)
    return { type: 'error', message: `Nobody by the name "${targetName}" is on file. Contracts need the handle spelled the way they spell it.` };
  if (String(target.id) === String(player.id))
    return { type: 'error', message: `You can't post a contract on yourself. The board has seen it tried; the board isn't interested.` };

  // The cut comes off the top and is disclosed in the confirmation, so the
  // number on the sheet is the number the hunter is actually paid. A poster
  // advertising a reward larger than the payout would be the one lie this
  // system genuinely cannot afford.
  const fee = Math.max(1, Math.ceil(amount * HOUSE_CUT));
  const escrow = amount - fee;
  if (escrow < 1) return { type: 'error', message: `That doesn't survive the house cut.` };

  if (!await adjustCredits(player, -amount, undefined, 'bounty:post'))
    return { type: 'error', message: `You're ${money(amount - (player.credits || 0))} short. Contracts are paid up front — the board doesn't run a tab.` };

  const now = Date.now();
  const row = {
    id: `bounty_${randomUUID()}`,
    target_id: String(target.id), target_handle: target.handle,
    backer_id: String(player.id), backer_handle: player.handle,
    amount: escrow, fee, note: String(note || '').slice(0, 200) || null,
    status: 'open', posted_at: now, expires_at: now + DURATION_MS,
    claimed_by: null, claimed_handle: null, claimed_at: null, unmasked_by: [],
  };
  await query(
    `INSERT INTO bounties (id,target_id,target_handle,backer_id,backer_handle,amount,fee,note,status,posted_at,expires_at,unmasked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,'[]'::jsonb)`,
    [row.id, row.target_id, row.target_handle, row.backer_id, row.backer_handle,
     row.amount, row.fee, row.note, row.posted_at, row.expires_at]);
  index(row);

  const poster = buildPoster(row, { viewer: player.id });
  broadcast(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} feeds a fistful of credits into ${board.name} and waits while it prints. A fresh sheet rolls out, still warm, and staples itself to the board.`,
  }, player.id);

  // The target is told, and told IMMEDIATELY. A bounty nobody knows about is
  // just an ambush with paperwork; the whole drama is in the target knowing the
  // number and not knowing the name.
  notifyTarget(row);

  return present(player, poster, {
    lead: `The board takes your money without curiosity.\n<span class="text-dim">${money(row.amount)} in escrow · ${money(row.fee)} house cut · ${DURATION_DAYS} days.</span>`,
    trail: `<span class="text-dim">Withdraw early and you forfeit ${Math.round(WITHDRAW_PENALTY * 100)}% (${sub('cancel')}). Let it run out and the escrow comes back whole.</span>`,
  });
}

function notifyTarget(row) {
  const live = getLivePlayer(row.target_id);
  if (!live) return;   // they'll be told at login (player.login below)
  sendToPlayer(row.target_id, {
    type: 'output',
    message: `<span class="text-danger">✱ Your tablet buzzes with an alert it was never meant to receive.</span>\n`
      + `<span class="text-danger">A contract has been posted on you: <b>${money(row.amount)}</b>.</span>\n`
      + `<span class="text-dim">No name on the sheet. ${teachVerb('bounty')} to read it; `
      + `${sub('unmask')} to find out what it would cost to learn who.</span>`,
  });
}

// ── the head ──────────────────────────────────────────────────────────────────
// Minted ONLY when there is an open contract. Otherwise every PvP death in the
// city litters a head nobody wants, and an object with no use is an object that
// teaches players to ignore the object.
on('player.death', ({ player: victim, killer }) => {
  if (!victim?.id || !killer?.id) return;
  const open = bountiesOn(victim.id);
  if (!open.length) return;
  mintHead(victim, killer).catch(err => console.error('[bounty] head mint failed:', err?.message));
});

async function mintHead(victim, killer) {
  const total = totalOn(victim.id);
  const custom = {
    bounty_head: true,
    victim_id: String(victim.id),
    victim_handle: victim.handle,
    taken_by: String(killer.id),
    taken_by_handle: killer.handle,
    taken_at: Date.now(),
    name: `${victim.handle}'s head`,
    description: `The head of ${victim.handle}, taken off the body and wrapped without ceremony in whatever was to hand. `
      + `It's worth ${money(total)} to the right board and nothing whatsoever anywhere else. `
      + `It doesn't keep. Nobody will look at you the same way while you're carrying it.`,
  };

  // Into the CORPSE, not the killer's pack. This is the decision the whole
  // system rests on: the head lies with the body, so the kill and the collection
  // are two separate acts with a walk between them, and anybody who was watching
  // the fight gets a turn. The corpse is looked up rather than passed in because
  // `player.death` carries no corpse id — and death is rare, so one query is the
  // correct tier for it (docs/architecture.md, persistence tiers).
  const { rows } = await query(
    `SELECT id FROM player_corpses WHERE player_id=$1 ORDER BY expires_at DESC LIMIT 1`, [victim.id]);
  // No corpse means a plugin took custody of the body (jail confiscation). The
  // head then goes to the killer directly — losing the bounty because the police
  // bagged the evidence would be a rule nobody could have known about.
  const holder = rows[0]?.id || String(killer.id);

  await query(
    `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data)
     VALUES ($1,$2,$3,1,1.0,$4)`,
    [randomUUID(), holder, HEAD_ITEM, JSON.stringify(custom)]);

  sendToPlayer(killer.id, {
    type: 'output',
    message: `<span class="text-warning">There's paper out on ${escHtml(victim.handle)} — ${money(total)} of it.</span>\n`
      + (rows[0]
        ? `<span class="text-dim">You do what the contract asks. The head goes into the corpse's kit; take it, and take it to a board (${teachVerb('redeem')}). Anyone can carry it in — including whoever gets it off you.</span>`
        : `<span class="text-dim">You take what the contract asks for, and it goes straight into your kit. A board will pay for it (${teachVerb('redeem')}).</span>`),
  });
}

// ── redeeming ─────────────────────────────────────────────────────────────────
async function cmdRedeem(args, raw, player, broadcast) {
  const board = boardHere(player.current_zone);
  if (!board) return { type: 'error', message: NO_BOARD };
  const rec = receptacleOf(board);
  if (!boardPowered(player.current_zone))
    return { type: 'error', message: recLine(rec, 'dark') };

  const { rows: heads } = await query(
    `SELECT id, custom_data FROM player_inventory
      WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL`,
    [player.id, HEAD_ITEM]);
  if (!heads.length)
    return { type: 'error', message: `You've nothing to hand in. ${recLine(rec, 'empty')}` };

  const want = args.join(' ').trim().toLowerCase();
  const picked = want
    ? heads.filter(h => String(h.custom_data?.victim_handle || '').toLowerCase().includes(want))
    : heads;
  if (!picked.length)
    return { type: 'error', message: `You're not carrying anything of "${want}".` };

  const out = [];
  let paid = 0;
  for (const head of picked) {
    const cd = head.custom_data || {};
    const victimId = String(cd.victim_id || '');
    // You cannot cash in your own head. It should not be possible to be holding
    // it, but looting your own corpse is a thing this game lets you do.
    if (victimId === String(player.id)) {
      out.push(`The board won't pay you for your own head. It does note, drily, that you tried.`);
      continue;
    }
    const contracts = bountiesOn(victimId);
    if (!contracts.length) {
      out.push(`<span class="text-dim">Nothing outstanding on ${escHtml(cd.victim_handle || 'them')} any more — the sheet came down. You're holding a head nobody is buying.</span>`);
      continue;
    }
    out.push(`<span class="text-dim">${recLine(rec, 'accept')}</span>`);
    for (const row of contracts) await settleClaim(row, player, broadcast, out);
    paid += contracts.reduce((a, c) => a + c.amount, 0);
    await query('DELETE FROM player_inventory WHERE id=$1', [head.id]).catch(() => {});
  }

  if (paid > 0) {
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: recLine(rec, 'room', { handle: player.handle, amount: money(paid) }),
    }, player.id);
  }
  return { type: 'output', message: out.join('\n') || 'Nothing to collect.' };
}

async function settleClaim(row, claimant, broadcast, out) {
  // Close the row FIRST, and only pay if this process is the one that closed it.
  // Two people cannot be paid the same escrow even if two heads arrive at two
  // boards in the same tick, because the guarded UPDATE decides which.
  const res = await query(
    `UPDATE bounties SET status='claimed', claimed_by=$2, claimed_handle=$3, claimed_at=$4
      WHERE id=$1 AND status='open'`,
    [row.id, String(claimant.id), claimant.handle, Date.now()]);
  if (!res.rowCount) { unindex(row.id); return; }
  unindex(row.id);

  await adjustCredits(claimant, row.amount, undefined, 'bounty:claim');
  out.push(`<span class="text-success">The board pays out on ${escHtml(row.target_handle)}: <b>${money(row.amount)}</b>.</span>`
    + (row.note ? `\n<span class="text-dim">The sheet said: ${escHtml(row.note)}</span>` : ''));

  sendToPlayer(row.backer_id, {
    type: 'output',
    message: `<span class="text-warning">✱ Your contract on ${escHtml(row.target_handle)} has been collected.</span>\n`
      + `<span class="text-dim">${money(row.amount)} paid out to ${escHtml(claimant.handle)}. The sheet is down.</span>`,
  });
  sendToPlayer(row.target_id, {
    type: 'output',
    message: `<span class="text-danger">✱ The contract on you has been collected.</span>\n`
      + `<span class="text-dim">${escHtml(claimant.handle)} walked ${money(row.amount)} out of a board with your name on the receipt.</span>`,
  });
}

// ── withdrawal, expiry, un-masking ────────────────────────────────────────────

async function cancelBounty(player, name) {
  const mine = openList().filter(b => String(b.backer_id) === String(player.id));
  if (!mine.length) return { type: 'error', message: `You've no contracts out.` };
  const want = String(name || '').trim().toLowerCase();
  const picked = want ? mine.filter(b => b.target_handle.toLowerCase().includes(want)) : mine;
  if (!picked.length) return { type: 'error', message: `You've nothing out on "${name}".` };
  if (picked.length > 1)
    return { type: 'error', message: `Which one? ${picked.map(b => b.target_handle).join(', ')}. Try \`bounty cancel <name>\`.` };

  const row = picked[0];
  const penalty = Math.ceil(row.amount * WITHDRAW_PENALTY);
  const back = row.amount - penalty;
  const res = await query(`UPDATE bounties SET status='withdrawn' WHERE id=$1 AND status='open'`, [row.id]);
  if (!res.rowCount) { unindex(row.id); return { type: 'error', message: `Too late — that one's already closed.` }; }
  unindex(row.id);
  await adjustCredits(player, back, undefined, 'bounty:withdraw');

  sendToPlayer(row.target_id, {
    type: 'output',
    message: `<span class="text-success">✱ The contract on you has been withdrawn.</span>\n<span class="text-dim">Somebody changed their mind, and paid to.</span>`,
  });
  return {
    type: 'output',
    message: `The sheet comes down. ${money(back)} back to you; ${money(penalty)} stays with the house for the inconvenience.`,
  };
}

// Idle-gated, and a pass over the in-memory Map rather than a query. Only rows
// that actually expire cost a round trip.
schedule('5m', async () => {
  const now = Date.now();
  for (const row of [...openBounties.values()]) {
    if (row.expires_at > now) continue;
    const res = await query(`UPDATE bounties SET status='expired' WHERE id=$1 AND status='open'`, [row.id]).catch(() => null);
    unindex(row.id);
    if (!res?.rowCount) continue;
    // The escrow comes back WHOLE. The house cut was spent when the sheet was
    // printed; charging it twice for the crime of nobody bothering would make
    // posting a bounty a bet against the server's population.
    const live = getLivePlayer(row.backer_id);
    if (live) {
      await adjustCredits(live, row.amount, undefined, 'bounty:expired');
      sendToPlayer(row.backer_id, {
        type: 'output',
        message: `<span class="text-dim">✱ Your contract on ${escHtml(row.target_handle)} ran out. Nobody collected. ${money(row.amount)} refunded — the house keeps only what it took at the counter.</span>`,
      });
    } else {
      // Offline backer: pay the row directly. `adjustCredits` needs a live
      // player object for its in-memory mirror, and there isn't one.
      await query('UPDATE players SET credits = credits + $1 WHERE id=$2', [row.amount, row.backer_id]).catch(() => {});
    }
    const target = getLivePlayer(row.target_id);
    if (target) sendToPlayer(row.target_id, {
      type: 'output',
      message: `<span class="text-success">✱ A contract on you expired unclaimed. You outlasted it.</span>`,
    });
  }
});

async function unmaskBounty(player, name) {
  const mine = bountiesOn(player.id);
  if (!mine.length) return { type: 'error', message: `Nobody has paper out on you. Enjoy it.` };
  const want = String(name || '').trim().toLowerCase();
  const picked = want ? mine.filter(b => String(b.amount).includes(want) || b.id.includes(want)) : mine;
  const row = picked[0] || mine[0];

  if (listOf(row.unmasked_by).includes(String(player.id)))
    return { type: 'output', message: `You already paid for that name: <b>${escHtml(row.backer_handle)}</b>.` };

  const cost = Math.max(1, Math.ceil(row.amount * UNMASK_COST));
  if (!await adjustCredits(player, -cost, undefined, 'bounty:unmask'))
    return {
      type: 'error',
      message: `A name costs ${money(cost)} — a quarter of what they staked, which the board considers fair, and you are ${money(cost - (player.credits || 0))} short of it.`,
    };

  const list = [...listOf(row.unmasked_by), String(player.id)];
  row.unmasked_by = list;
  await query(`UPDATE bounties SET unmasked_by=$2 WHERE id=$1`, [row.id, JSON.stringify(list)]).catch(() => {});

  return {
    type: 'output',
    message: `You pay ${money(cost)} into a slot that doesn't print a receipt, and a single line comes back.\n`
      + `<span class="text-danger">The contract on you was posted by <b>${escHtml(row.backer_handle)}</b>.</span>\n`
      + `<span class="text-dim">The board doesn't tell them you asked. That part is up to you.</span>`,
  };
}

// ── the verb ──────────────────────────────────────────────────────────────────

const HELP = [
  `<b>BOUNTIES</b> — money on a head, paid on delivery.`,
  ``,
  `  ${teachVerb('bounty')}                       the boards, and anything out on you`,
  `  <b>bounty &lt;name&gt; &lt;amount&gt; [why]</b>   post a contract (at a board)`,
  `  <b>bounty &lt;name&gt;</b>                 read that sheet in full`,
  `  <b>bounty cancel [name]</b>            pull your own sheet down (costs ${Math.round(WITHDRAW_PENALTY * 100)}%)`,
  `  <b>bounty unmask</b>                   pay to learn who paid for you`,
  `  ${teachVerb('redeem')}                       hand a head in at a board`,
  ``,
  `<span class="text-dim">A kill on somebody with paper out leaves a head with the body. Bring the head to a board and the board pays whoever is holding it — which doesn't have to be the person who took it.</span>`,
].join('\n');

async function cmdBounty(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'help') return { type: 'output', message: HELP };
  if (sub === 'cancel' || sub === 'withdraw') return cancelBounty(player, args.slice(1).join(' '));
  if (sub === 'unmask' || sub === 'who') return unmaskBounty(player, args.slice(1).join(' '));

  // `bounty <name> <amount> [reason]` — an amount anywhere after the name means
  // this is a posting. Nothing else in the grammar takes a number, so this can
  // never be mistaken for a lookup.
  const amtIdx = args.findIndex((t, i) => i > 0 && /^\d+$/.test(t));
  if (amtIdx > 0) {
    return postBounty(player, args.slice(0, amtIdx).join(' '),
      parseInt(args[amtIdx], 10), args.slice(amtIdx + 1).join(' '), broadcast);
  }

  const list = openList();
  const wanted = args.join(' ').trim();
  if (wanted) {
    const hit = list.find(b => b.target_handle.toLowerCase() === wanted.toLowerCase())
      || list.find(b => b.target_handle.toLowerCase().includes(wanted.toLowerCase()));
    if (!hit) return { type: 'error', message: `No sheet up on "${wanted}". <span class="text-dim">${teachVerb('bounty')} for what is.</span>` };
    return present(player, buildPoster(hit, { viewer: player.id }));
  }

  return { type: 'output', message: listing(player, list) };
}

// The board / list view. Rows, not sheets — twelve full posters is a wall.
function listing(player, list) {
  const onMe = bountiesOn(player.id);
  const mine = list.filter(b => String(b.backer_id) === String(player.id));
  const lines = [`<b>✱ OPEN CONTRACTS ✱</b>`];

  if (!list.length) {
    lines.push(`<span class="text-dim">Nothing up. Either the city is at peace or everybody with a grievance is broke.</span>`);
  } else {
    lines.push(`<span class="text-dim">${'NAME'.padEnd(20)}${'REWARD'.padStart(10)}  CLOSES</span>`);
    for (const b of list.slice(0, 12)) lines.push(escHtml(posterRow(buildPoster(b, { viewer: player.id }))));
    if (list.length > 12) lines.push(`<span class="text-dim">…and ${list.length - 12} more.</span>`);
  }

  if (onMe.length) {
    lines.push(``, `<span class="text-danger">► ${onMe.length === 1 ? "There's a sheet up with your name on it" : `There are ${onMe.length} sheets up with your name on them`}: ${money(totalOn(player.id))} in total.</span>`);
    lines.push(`<span class="text-dim">${sub('unmask')} to pay for a name.</span>`);
  }
  if (mine.length) {
    lines.push(``, `<span class="text-dim">Yours: ${mine.map(b => `${escHtml(b.target_handle)} (${money(b.amount)})`).join(', ')}.</span>`);
  }
  lines.push(``, `<span class="text-dim">${sub('help')} · read one in full with <b>bounty &lt;name&gt;</b></span>`);
  return lines.join('\n');
}

// ── one payload, two presentations ────────────────────────────────────────────
// The sheet ALWAYS goes to the log. The panel is opened alongside it for anyone
// not at the `log` rung, and carries the identical lines — so closing it, never
// seeing it, or being on a screen reader costs the player nothing but the paper
// texture. `loggedPanelsSync` reads the login-hydrated latch, so this is safe
// anywhere including a broadcast path.
function present(player, poster, { lead = '', trail = '' } = {}) {
  const block = [lead, posterBlock(poster), trail].filter(Boolean).join('\n');
  const msg = { type: 'wanted_poster', message: block, poster };
  if (loggedPanelsSync(player)) msg.render = 'log';   // no panel at the bottom rung
  return msg;
}

// ── the board itself ──────────────────────────────────────────────────────────
export const hooks = {
  // A board says how much work is on it before you read it. A player who never
  // types `bounty` still finds out this system exists by walking past one.
  //
  // ⚠ TWO KINDS OF FURNITURE COME THROUGH HERE. A `wanted_board` is a Severance
  // terminal — a screen and a receptacle — and a `bulletin` board is cork and
  // staples. One line describing stapled paper on a machine that holds no paper
  // was the whole reason this branched.
  'furniture.describe': async (f) => {
    if (!f || !BOARD_TAGS.some(t => hasTag(f, t))) return undefined;
    const machine = hasTag(f, 'wanted_board');
    const rec = receptacleOf(f);
    if (machine && !boardPowered(f.zone_id))
      return `<span class="text-dim">${escHtml(recLine(rec, 'dark'))}</span>`;
    const n = openBounties.size;
    if (!n) return machine
      ? `<span class="text-dim">The screen cycles an empty list and starts again. No contracts open. (${teachVerb('bounty')})</span>`
      : `<span class="text-dim">A few staples and the torn corners of older sheets. Nothing current. (${teachVerb('bounty')})</span>`;
    const top = openList()[0];
    const head = machine
      ? `The screen is working through ${n === 1 ? 'a single contract' : `${n} open contracts`}`
        + `. The one showing wants ${escHtml(top.target_handle)}, for ${money(top.amount)}.`
      : `${n === 1 ? 'One sheet' : `${n} sheets`} of fresh WANTED paper, stapled over each other`
        + `. The top one wants ${escHtml(top.target_handle)}, for ${money(top.amount)}.`;
    return `<span class="text-warning">${head}</span>`
      + `\n<span class="text-dim">${teachVerb('bounty')} to read it · <b>bounty &lt;name&gt; &lt;amount&gt;</b> to add one`
      + `${machine ? ` · ${teachVerb('redeem')} at ${escHtml(rec.noun)} to collect` : ''}.</span>`;
  },
};

// READ a board — the same listing the verb prints, because a board and a verb
// showing different contracts is the bug this whole one-builder rule prevents.
//
// ⚠ IT MUST SELF-GATE AND FALL THROUGH. `read` is a heavily shared verb (recipe
// cards, books, the leaderboard); a specializedAction that answers unconditionally
// eats every one of them. Returning `undefined` when there is no board in the room
// hands the verb straight back — the same shape plugins/bulletin uses, and the
// reason its handler resolves the furniture itself rather than trusting the tag
// gate to have done it.
export const specializedActions = [{
  verb: 'read', requiredTag: 'wanted_board',
  handler: async (args, raw, player) => {
    const name = args.join(' ').replace(/^(the)\s+/i, '').trim();
    const board = boardHere(player.current_zone, name);
    if (!board) return undefined;                       // not a board → fall through
    return { type: 'output', message: listing(player, openList()) };
  },
}];

// Told at login, because being told while offline is being told nothing.
on('player.login', ({ player }) => {
  if (!player?.id) return;
  const on_ = bountiesOn(player.id);
  if (!on_.length) return;
  setTimeout(() => sendToPlayer(player.id, {
    type: 'output',
    message: `<span class="text-danger">✱ There ${on_.length === 1 ? 'is a contract' : `are ${on_.length} contracts`} out on you — ${money(totalOn(player.id))}.</span>\n`
      + `<span class="text-dim">${teachVerb('bounty')} to read the sheet.</span>`,
  }), 4000);
});

export const commands = { bounty: cmdBounty, bounties: cmdBounty, redeem: cmdRedeem };

// Exposed for the regression suite and the tablet app only.
export const _internal = { openBounties, byTarget, index, unindex, loadBounties, boardHere, listing, HEAD_ITEM };

console.log('[bounty] Plugin loaded.');
