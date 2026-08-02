// TRADING CARDS — mint, packs, shelf.
//
// A card is a frozen snapshot of somebody. A PLAYER mints themselves at a terminal,
// because the card system deliberately does NOT follow anybody around — tracking
// every player's kit for a collectible would be a hot-path cost — so a player has
// to walk somewhere and hand the system the moment. An NPC or ENEMY needs no such
// thing: their rows ARE static content, so those cards are struck unattended when a
// series opens and can never go stale.
//
// Nothing here is on a hot path. Card reads are cold, the pool is cached in memory
// behind one writer, and no tick is registered.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZoneFurniture, getZone } from '../../server/engine/world.js';
import { isPluggedIn } from '../appliances/index.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import {
  buildPlayerCard, buildNpcCard, buildEnemyCard, rollSleeve, RANKS, RANK_WEIGHT,
  BUDGET, SILENCE,
} from './builder.js';

const MINT_FEE = 2500;
// THESE TWO NUMBERS ARE COUPLED — never move one without the other.
//
// Scrap is the FLOOR under the pack price. A shelf near completion pulls mostly
// duplicates, so a sleeve's worst case is `size × SCRAP_VALUE` coming straight
// back out; if that ever reaches PACK_PRICE the machine stops being a gamble and
// becomes a money printer, and the correct play becomes buying packs forever.
// Worst case here is the 1% nine-card mis-cut: 9 × 25 = ₵225 against ₵250, so
// even the fattest all-dupe sleeve loses money. Keep that inequality true.
//
// The absolute level is set by the job board, not by what a card "feels" worth:
// gigs pay ₵10–15 at the bottom and average ₵88, so ₵250 is about three ordinary
// jobs — an impulse buy you can make several times a session, which is what the
// reveal is built to invite. It sat at ₵900 while a pack was a one-off curiosity;
// that was the price of a Surveillance Deck, and nothing at that price gets
// bought on a whim.
const PACK_PRICE = 250;
const SCRAP_VALUE = 25;
const MINT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// The sleeve is a real inventory row, not an abstraction. You buy an unopened
// pack, you carry it, and you tear it when you feel like it — which is the whole
// reason the reveal is worth animating: the moment is CHOSEN, not a side effect
// of paying. It also means a sleeve can sit in a drawer, be dropped, or be given
// away unopened, all of which fall out of it being an ordinary item for free.
const PACK_ITEM = 'card_foil_sleeve';

// ── in-memory state ────────────────────────────────────────────────────────────
// Recent speech per player, for the Overheard region. Capped, never persisted:
// a restart forgetting what you said an hour ago is the correct amount of memory.
const recentSay = new Map();          // playerId -> [{ text, zoneId, at }]
// The pack pool, cached behind one writer (mint + strike). See architecture.md
// read tiers: a pack pull must not hit the DB for the whole catalogue.
let pool = null;                      // [{ id, rarity, subject_name, subject_type }]

function invalidatePool() { pool = null; }

// A rank the pool can't fill yet (nobody has minted an Epic) steps DOWN to the
// nearest populated rank, never sideways into the whole catalogue — otherwise a
// rolled Epic quietly pays out a random Common and the guarantee on the last card
// stops meaning anything.
// `floorIdx` is the lowest rank this slot may ever pay out. The hit card passes 1
// (uncommon), which is what keeps the every-sleeve guarantee true even on a young
// pool: it steps UP rather than dropping to Common.
export function pickAtRank(catalogue, rank, floorIdx = 0) {
  const at = i => catalogue.filter(c => c.rarity === RANKS[i]);
  const start = RANKS.indexOf(rank);
  for (let i = start; i >= floorIdx; i--) {          // best available at or below
    const set = at(i);
    if (set.length) return set[Math.floor(Math.random() * set.length)];
  }
  for (let i = start + 1; i < RANKS.length; i++) {   // nothing below: step up
    const set = at(i);
    if (set.length) return set[Math.floor(Math.random() * set.length)];
  }
  return catalogue[Math.floor(Math.random() * catalogue.length)];
}

async function getPool() {
  if (pool) return pool;
  const { rows } = await query(
    `SELECT id, rarity, subject_name, subject_type FROM cards WHERE pool_weight > 0`
  );
  pool = rows;
  return pool;
}

function onSay({ player, text, zoneId }) {
  if (!player?.id || !text) return;
  const list = recentSay.get(player.id) || [];
  list.unshift({ text: String(text), zoneId, at: Date.now() });
  recentSay.set(player.id, list.slice(0, 12));
}

// Candidate quotes: said HERE, in the last 30 minutes, newest first. The builder
// picks the first that fits 90 chars — it never edits a line to make it fit.
function quotesFor(player) {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return (recentSay.get(player.id) || [])
    .filter(s => s.at >= cutoff && s.zoneId === player.current_zone)
    .map(s => s.text);
}

// ── furniture lookup ───────────────────────────────────────────────────────────
// The dispatcher hands plugin commands an ARRAY of words (commands/index.js:188).
const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a || '')).trim();

const mintHere = z => getZoneFurniture(z).find(f => f.flags?.card_mint);
const machineHere = z => getZoneFurniture(z).find(f => f.flags?.vends_packs);

// ── striking a card ────────────────────────────────────────────────────────────
async function nextSerial(series) {
  const { rows } = await query('SELECT COALESCE(MAX(serial),0)+1 AS n FROM cards WHERE series=$1', [series]);
  return Number(rows[0]?.n) || 1;
}

async function insertCard(card, { series = 1, zoneId = null, poolWeight } = {}) {
  const serial = await nextSerial(series);
  const weight = poolWeight != null ? poolWeight : (RANK_WEIGHT[card.rarity] ?? 0);
  const { rows } = await query(
    `INSERT INTO cards (series, serial, subject_type, subject_ref, subject_name, body, spec,
                        text_blocks, rarity, power, zone_id, pool_weight)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, serial`,
    [series, serial, card.subject_type, card.subject_ref, card.subject_name, card.body,
     JSON.stringify(card.spec || {}), JSON.stringify(card.text_blocks || {}),
     card.rarity, card.power || 0, zoneId, weight]
  );
  invalidatePool();
  return { id: rows[0].id, serial: rows[0].serial, series };
}

async function grant(playerId, cardId) {
  const { rows } = await query(
    `INSERT INTO card_holdings (player_id, card_id, qty) VALUES ($1,$2,1)
     ON CONFLICT (player_id, card_id) DO UPDATE SET qty = card_holdings.qty + 1
     RETURNING qty`,
    [playerId, cardId]
  );
  return Number(rows[0]?.qty) || 1;
}

// ── rendering ──────────────────────────────────────────────────────────────────
const RANK_CLASS = { common: 'text-dim', uncommon: 'card-r-uncommon', rare: 'card-r-rare',
                     epic: 'card-r-epic', legendary: 'card-r-legendary', architect: 'card-r-architect' };
const rankSpan = r => `<span class="card-rank ${RANK_CLASS[r] || 'text-dim'}">${r.toUpperCase()}</span>`;

export function renderCard(row) {
  const t = row.text_blocks || {};
  const s = row.spec || {};
  const out = [];
  out.push(`<span class="card-face card-${row.rarity}">`);
  out.push(`<span class="card-serial">Series ${row.series} · № ${String(row.serial).padStart(4, '0')}</span>`);
  out.push(`<span class="card-handle">${row.subject_name}</span>`);
  out.push(`<span class="card-sub">${t.epithet || row.subject_type} · ${rankSpan(row.rarity)}</span>`);
  if (t.last_seen) out.push(`<span class="card-block"><span class="card-lbl">${row.subject_type === 'enemy' ? 'In the field' : 'Last seen'}</span>${t.last_seen}</span>`);
  if (t.origin) out.push(`<span class="card-block"><span class="card-lbl">${row.subject_type === 'enemy' ? 'What it leaves' : 'In their own words'}</span><i>“${t.origin}”</i></span>`);
  out.push(`<span class="card-quote">${t.quote === SILENCE ? `<i>${SILENCE}</i>` : `“${t.quote}”`}</span>`);
  if (Array.isArray(s.manifest) && s.manifest.length) {
    out.push(`<span class="card-block"><span class="card-lbl">Manifest</span>${s.manifest.map(m => `${m.name} <span class="text-dim">· ${m.band}</span>`).join(', ')}</span>`);
  }
  if (s.hp_max) out.push(`<span class="card-block"><span class="card-lbl">Field data</span>HP ${s.hp_max} · hit ${s.hit ?? 1} · dodge ${s.dodge ?? 1}</span>`);
  out.push(`<span class="card-power">${row.subject_type === 'enemy' ? 'Threat' : row.subject_type === 'npc' ? 'Standing' : 'Power'} <b>${row.power}</b></span>`);
  out.push(`</span>`);
  return out.join('');
}

// ── verbs ──────────────────────────────────────────────────────────────────────

async function cmdMint(args, raw, player, broadcast) {
  const machine = mintHere(player.current_zone);
  if (!machine) return { type: 'error', message: "There's no mint terminal here. The Coldwater Mint keeps its machines somewhere respectable." };
  if (!isPluggedIn(machine)) return { type: 'error', message: `The ${machine.name} is dark. No power, no card.` };

  const confirming = /^(confirm|yes|y)$/i.test(argStr(args));

  const { rows: equipped } = await query(
    `SELECT item_id, layer, condition FROM player_inventory WHERE player_id=$1 AND is_equipped=1`,
    [player.id]
  );
  const { physicalDescription } = await import('../../server/engine/appearance.js');
  const card = buildPlayerCard({
    player, equipped,
    physLine: physicalDescription(player, false) || '',
    quotes: quotesFor(player),
  });

  // PREVIEW FIRST, always. Nobody should pay and THEN discover their quote
  // didn't qualify.
  if (!confirming) {
    const gaps = [];
    if (!card.text_blocks.origin) gaps.push('no <b>.describe</b> text will print — write one with <span class="cmd">describe</span> first');
    if (card.text_blocks.quote === SILENCE) gaps.push('nothing you said here recently fits the quote line');
    return {
      type: 'output',
      message: `<span class="card-preview">${renderCard({ ...card, series: 1, serial: 0 })}</span>\n`
        + (gaps.length ? `<span class="warning">Before you pay: ${gaps.join('; ')}.</span>\n` : '')
        + `Minting costs <b>₵${MINT_FEE}</b> and freezes this exactly as it stands. `
        + `Type <span class="cmd">mint confirm</span> to strike it.`,
    };
  }

  if ((player.credits || 0) < MINT_FEE) return { type: 'error', message: `Minting costs ₵${MINT_FEE}. You have ₵${player.credits || 0}.` };

  const { rows: last } = await query(
    `SELECT minted_at FROM cards WHERE subject_type='player' AND subject_ref=$1 ORDER BY minted_at DESC LIMIT 1`,
    [String(player.id)]
  );
  const lastAt = Number(last[0]?.minted_at || 0) * 1000;
  if (lastAt && Date.now() - lastAt < MINT_COOLDOWN_MS) {
    const days = Math.ceil((MINT_COOLDOWN_MS - (Date.now() - lastAt)) / 86400000);
    return { type: 'error', message: `You minted too recently. The Mint will take you again in ${days} day${days === 1 ? '' : 's'}.` };
  }

  player.credits -= MINT_FEE;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  const zone = getZone(player.current_zone);
  const struck = await insertCard(card, { zoneId: player.current_zone });
  await grant(player.id, struck.id);

  const { date, time } = getGameDateTime();
  broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} chatters, and cuts a card with ${player.handle}'s face on it.` }, player.id);
  return {
    type: 'output',
    message: `${renderCard({ ...card, series: struck.series, serial: struck.serial })}\n`
      + `<span class="success">Struck № ${String(struck.serial).padStart(4, '0')} — ${date}, ${time}, ${zone?.name || 'here'}. `
      + `It's in the pool now. Somebody will pull you out of a machine.</span>`,
  };
}

// How many unopened sleeves you're carrying. Counts every row rather than one,
// because a sleeve in a bag is still a sleeve — the pack has no reason to care
// which pocket it's in.
async function packsHeld(playerId) {
  const { rows } = await query(
    'SELECT COALESCE(SUM(quantity),0) AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2',
    [playerId, PACK_ITEM]
  );
  return Number(rows[0]?.n) || 0;
}

async function giveSleeve(playerId) {
  const { rows } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1',
    [playerId, PACK_ITEM]
  );
  if (rows.length) {
    await query('UPDATE player_inventory SET quantity = quantity + 1 WHERE id=$1', [rows[0].id]);
  } else {
    await query('INSERT INTO player_inventory (id, player_id, item_id, quantity) VALUES ($1,$2,$3,1)',
      [randomUUID(), playerId, PACK_ITEM]);
  }
}

// Take one sleeve off the pile. Returns false if there wasn't one — the caller
// must not roll anything until this has succeeded, or a failed decrement pays
// out a free pack.
async function consumeSleeve(playerId) {
  const { rows } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 ORDER BY quantity ASC LIMIT 1',
    [playerId, PACK_ITEM]
  );
  if (!rows.length) return false;
  if (Number(rows[0].quantity) > 1) {
    await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [rows[0].id]);
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [rows[0].id]);
  }
  return true;
}

// The odds board the machine prints. Derived from the LIVE pool, so a young pool
// that can't fill an Epic shows that instead of advertising one.
function poolBreakdown(catalogue) {
  const by = {};
  for (const r of RANKS) by[r] = 0;
  for (const c of catalogue) if (by[c.rarity] != null) by[c.rarity]++;
  return by;
}

// `buypack` opens the machine's face rather than transacting: the terminal is a
// thing you stand at and press buttons on, exactly like an ATM, and the panel is
// where the price, the odds board and your own credit balance are legible before
// you commit. `buypack confirm` is the button.
async function cmdBuyPack(args, raw, player, broadcast) {
  const machine = machineHere(player.current_zone);
  if (!machine) return { type: 'error', message: "There's no card machine here." };
  if (!isPluggedIn(machine)) return { type: 'error', message: `The ${machine.name}'s window is dark. The glass just shows you the room.` };

  const catalogue = await getPool();
  const confirming = /^(confirm|buy|yes|y)$/i.test(argStr(args));

  if (!confirming) {
    return {
      type: 'cardmach_panel',
      machine: machine.name,
      price: PACK_PRICE,
      scrapValue: SCRAP_VALUE,
      credits: player.credits || 0,
      packs: await packsHeld(player.id),
      pool: { total: catalogue.length, byRank: poolBreakdown(catalogue) },
      message: catalogue.length
        ? `The ${machine.name} lights its window.`
        : `The ${machine.name} lights its window. Every slot reads SOLD OUT — nobody has minted anything yet.`,
    };
  }

  if (!catalogue.length) return { type: 'error', message: `The ${machine.name} is empty. Nobody has minted anything yet.` };
  if ((player.credits || 0) < PACK_PRICE) return { type: 'error', message: `A sleeve is ₵${PACK_PRICE}. You have ₵${player.credits || 0}.` };

  player.credits -= PACK_PRICE;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await giveSleeve(player.id);

  broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} thumps, and drops a foil sleeve into ${player.handle}'s hand.` }, player.id);
  return {
    type: 'cardmach_vend',
    machine: machine.name,
    credits: player.credits,
    packs: await packsHeld(player.id),
    message: `The ${machine.name} thumps. A foil sleeve lands in the tray — <b>₵${PACK_PRICE}</b> gone, <b>₵${player.credits}</b> left. `
      + `Tear it whenever you like: <span class="cmd">openpack</span>.`,
  };
}

// Tearing one. The roll happens HERE, not at the vend — an unopened sleeve holds
// no result, so nothing on the shelf can be datamined, traded pre-rolled, or go
// stale against a pool that grew while it sat in your coat.
async function cmdOpenPack(args, raw, player, broadcast) {
  const catalogue = await getPool();
  if (!catalogue.length) return { type: 'error', message: 'The pool is empty. There is nothing in the sleeve to be.' };
  if (!(await consumeSleeve(player.id))) {
    return { type: 'error', message: `You have no unopened sleeves. They come out of a card machine — ₵${PACK_PRICE} a go.` };
  }

  const ranks = rollSleeve();
  const picks = ranks.map((rank, i) => pickAtRank(catalogue, rank, i === ranks.length - 1 ? 1 : 0));

  // One read for the whole sleeve, never one per card (architecture.md read
  // tiers) — the reveal wants the full face, and the pool only carries the stub.
  const { rows: full } = await query('SELECT * FROM cards WHERE id = ANY($1)', [picks.map(p => p.id)]);
  const byId = new Map(full.map(r => [r.id, r]));

  const cards = [];
  const lines = [];
  let scrapped = 0;
  for (let i = 0; i < picks.length; i++) {
    const qty = await grant(player.id, picks[i].id);
    const dupe = qty > 1;
    if (dupe) scrapped += SCRAP_VALUE;
    const row = byId.get(picks[i].id);
    const hit = i === picks.length - 1;
    cards.push({
      id: picks[i].id,
      name: picks[i].subject_name,
      subject_type: picks[i].subject_type,
      rarity: picks[i].rarity,
      hit, dupe,
      // The face is rendered SERVER-side from the same renderCard the shelf uses,
      // so the card you flip over in the reveal and the card you read later can
      // never drift apart.
      face: row ? renderCard(row) : '',
    });
    lines.push(`<span class="card-pull card-pull-${picks[i].rarity}${hit ? ' card-pull-hit' : ''}" data-delay="${i}">`
      + `${rankSpan(picks[i].rarity)} <span class="card-pull-name">${picks[i].subject_name}</span> `
      + `<span class="text-dim">${picks[i].subject_type}</span>`
      + (dupe ? ` <span class="card-dupe">DUPE ₵${SCRAP_VALUE}</span>` : '')
      + `</span>`);
  }

  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} tears open a foil sleeve.` }, player.id);
  return {
    type: 'cardpack_open',
    cards,
    scrapValue: SCRAP_VALUE,
    scrapped,
    packs: await packsHeld(player.id),
    // The text log is the fallback, and it is NOT optional: a player who closes
    // the overlay mid-reveal, or whose client is old enough not to know the type,
    // still has to be able to read what they pulled.
    message: `<span class="card-sleeve" data-count="${cards.length}">`
      + `<span class="card-tear">The sleeve tears. <b>${cards.length}</b> cards.</span>`
      + lines.join('')
      + `</span>`
      + (scrapped ? `\n<span class="text-dim">Dupes in there — <span class="cmd">scrap</span> them for ₵${scrapped}.</span>` : ''),
  };
}

async function cmdCards(args, raw, player) {
  const filter = argStr(args).toLowerCase();
  const { rows } = await query(
    `SELECT c.*, h.qty FROM card_holdings h JOIN cards c ON c.id = h.card_id
     WHERE h.player_id=$1 ORDER BY c.series, c.serial`,
    [player.id]
  );
  if (!rows.length) return { type: 'output', message: `You have no cards. A sleeve is ₵${PACK_PRICE} from any card machine.` };

  // `cards <name>` reads one card in full; bare `cards` lists the shelf.
  if (filter) {
    const hit = rows.find(r => r.subject_name.toLowerCase().includes(filter));
    if (!hit) return { type: 'error', message: `Nothing on your shelf matches "${filter}".` };
    return { type: 'output', message: renderCard(hit) };
  }

  const byRank = {};
  for (const r of rows) (byRank[r.rarity] ||= []).push(r);
  const order = [...RANKS].reverse().concat('architect');
  const out = [`<span class="card-shelf-head">Your shelf — ${rows.length} card${rows.length === 1 ? '' : 's'}</span>`];
  for (const rank of order) {
    const set = byRank[rank];
    if (!set?.length) continue;
    out.push(`<span class="card-shelf-row">${rankSpan(rank)} ` + set.map(r =>
      `<span class="action-link" data-action="cards" data-target="${r.subject_name}" title="Read this card">${r.subject_name}</span>${r.qty > 1 ? `<span class="text-dim">×${r.qty}</span>` : ''}`
    ).join(', ') + `</span>`);
  }
  return { type: 'output', message: out.join('\n') };
}

async function cmdScrap(args, raw, player) {
  const machine = mintHere(player.current_zone);
  if (!machine) return { type: 'error', message: 'Scrapping is done at a mint terminal, not in the street.' };
  const { rows } = await query(
    `SELECT h.card_id, h.qty, c.subject_name FROM card_holdings h JOIN cards c ON c.id=h.card_id
     WHERE h.player_id=$1 AND h.qty > 1`,
    [player.id]
  );
  if (!rows.length) return { type: 'output', message: 'Nothing doubled up. Your shelf is already clean.' };

  let total = 0;
  for (const r of rows) {
    const extra = r.qty - 1;
    total += extra * SCRAP_VALUE;
    await query('UPDATE card_holdings SET qty=1 WHERE player_id=$1 AND card_id=$2', [player.id, r.card_id]);
  }
  player.credits = (player.credits || 0) + total;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  return { type: 'output', message: `The ${machine.name} eats ${rows.length} stack${rows.length === 1 ? '' : 's'} of duplicates and pays out <b>₵${total}</b>.` };
}

// ── striking the world (admin / series open) ───────────────────────────────────
// Sweeps world content and cuts a card for every eligible NPC and enemy, so the
// pool is full on day one. Idempotent: a subject already carded in this series is
// skipped, so it is safe to re-run after adding content.
export async function strikeSeries(series = 1) {
  const [{ rows: npcs }, { rows: enemies }, { rows: spawns }, { rows: existing }] = await Promise.all([
    query('SELECT * FROM npcs'),
    query('SELECT * FROM enemies'),
    query('SELECT enemy_id, SUM(max_count) AS max_count, MIN(spawn_weight) AS spawn_weight, COUNT(*) AS zones FROM zone_spawns GROUP BY enemy_id'),
    query('SELECT subject_type, subject_ref FROM cards WHERE series=$1', [series]),
  ]);
  const have = new Set(existing.map(r => `${r.subject_type}:${r.subject_ref}`));
  const spawnBy = new Map(spawns.map(s => [s.enemy_id, s]));
  let struck = 0;

  for (const npc of npcs) {
    if (have.has(`npc:${npc.id}`) || npc.flags?.card_exclude) continue;
    if (!String(npc.description || '').trim()) continue;
    await insertCard(buildNpcCard(npc), { series });
    struck++;
  }
  for (const e of enemies) {
    if (have.has(`enemy:${e.id}`) || e.flags?.card_exclude) continue;
    if (!String(e.description || '').trim()) continue;
    await insertCard(buildEnemyCard(e, spawnBy.get(e.id) || {}), { series });
    struck++;
  }
  invalidatePool();
  return struck;
}

// Admin-issued Architect rank. pool_weight 0 — it never rolls and never appears
// in a pack, so it only enters circulation by being traded.
export async function issueArchitect({ handle, epithet, lastSeen, origin, quote }) {
  const { rows } = await query('SELECT id, handle FROM players WHERE LOWER(handle)=LOWER($1)', [handle]);
  if (!rows.length) return { error: 'No such player.' };
  const card = {
    subject_type: 'player', subject_ref: String(rows[0].id), subject_name: rows[0].handle,
    body: 'male', rarity: 'architect', power: 0, spec: { issued: true },
    text_blocks: { epithet: epithet || 'Architect issue', last_seen: lastSeen || '', origin: origin || '', quote: quote || SILENCE },
  };
  const struck = await insertCard(card, { poolWeight: 0 });
  await grant(rows[0].id, struck.id);
  return { ok: true, ...struck };
}

// ── the machine's panel, on examine ────────────────────────────────────────────
// `furniture.describe`, not `zone.furniturePanel`: the lit product window used to
// be welded into the room description, which meant every look at a shop with a
// machine in it paid for a block of cabinet art nobody asked for. A machine is a
// thing you walk up to. So it lists as ordinary furniture like everything else,
// and the window only opens when you examine it.
//
// Powered, it's a lit window with a working control; unpowered, the same block
// renders dark, so the machine is visibly present and visibly useless rather
// than silently absent.
//
// The control is `data-action="cmd" data-cmd="…"`, which sends the verb verbatim.
// It used to be `data-action="buypack" data-target=""`, and the empty target was
// fatal: the click handler bails on `!action || !target`, so the button did
// nothing at all — the one route the panel advertised was the one that couldn't work.
function cardFurnitureDescribe(f) {
  const isMachine = !!f?.flags?.vends_packs;
  const isMint = !!f?.flags?.card_mint;
  if (!isMachine && !isMint) return undefined;
  const live = isPluggedIn(f);

  if (!live) {
    return `<span class="cardmach cardmach-dead${isMint ? ' cardmach-mint' : ''}">`
      + `<span class="cardmach-top"><span class="cardmach-pwr">○ DARK</span></span>`
      + `<span class="cardmach-win cardmach-off">— no power —${isMachine ? '\nthe glass just shows you the room' : ''}</span>`
      + `</span>`;
  }

  // The lit product window used to be drawn HERE, in the log. It isn't any more:
  // the machine's face is the panel (`flags.click_cmd: buypack` opens it straight
  // from the room list), so examine leaves one line and the way in. Two drawings
  // of the same cabinet, one of them scrollable, was one too many.
  if (isMachine) {
    return `<span class="cardmach">`
      + `<span class="cardmach-top"><span class="cardmach-pwr">● PWR</span></span>`
      + `<span class="action-link cardmach-buy" data-action="cmd" data-cmd="buypack" title="Step up to the machine">USE MACHINE · ₵${PACK_PRICE} A SLEEVE</span>`
      + `</span>`;
  }
  return `<span class="cardmach cardmach-mint">`
    + `<span class="cardmach-top"><span class="cardmach-pwr">● READY</span></span>`
    + `<span class="cardmach-win">Strike your own card — ₵${MINT_FEE}\nOne every 7 days. Frozen at the moment you pay.</span>`
    + `<span class="action-link cardmach-buy" data-action="cmd" data-cmd="mint" title="Preview your card">PREVIEW · FREE</span>`
    + `</span>`;
}

// ── dev-panel API ──────────────────────────────────────────────────────────────
// Admin-only. Edits CARDS, never subjects: the NPC overrides (flags.card_quote,
// card_note, card_rarity) live on the NPC row and are edited in the NPCs panel,
// so there is one home per entity.
export const routePrefix = '/cards';

export async function routeHandler(path, method, body, auth) {
  if (!auth || auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };

  if (path === '/cards' && method === 'GET') {
    const { rows } = await query(
      `SELECT c.*, (SELECT COALESCE(SUM(qty),0) FROM card_holdings h WHERE h.card_id=c.id) AS held
       FROM cards c ORDER BY c.series, c.serial`
    );
    // The budgets travel with the payload so the panel's character counters and
    // the builder can never drift apart.
    return { status: 200, body: { cards: rows, budgets: BUDGET, ranks: [...RANKS, 'architect'] } };
  }

  if (path === '/cards/strike' && method === 'POST') {
    const struck = await strikeSeries(Number(body?.series) || 1);
    return { status: 200, body: { ok: true, struck } };
  }

  if (path === '/cards/architect' && method === 'POST') {
    const r = await issueArchitect(body || {});
    return r.error ? { status: 400, body: r } : { status: 200, body: r };
  }

  const one = path.match(/^\/cards\/(\d+)$/);
  if (one && method === 'PUT') {
    const id = Number(one[1]);
    const { rows } = await query('SELECT * FROM cards WHERE id=$1', [id]);
    if (!rows.length) return { status: 404, body: { error: 'No such card' } };
    const cur = rows[0];
    const blocks = { ...(cur.text_blocks || {}), ...(body?.text_blocks || {}) };
    // Refuse an over-budget block here rather than letting it reach a card. The
    // panel shows the counters; this is the backstop.
    for (const [k, cap] of [['last_seen', BUDGET.lastSeen], ['origin', BUDGET.origin], ['quote', BUDGET.quote], ['epithet', BUDGET.epithet]]) {
      if (blocks[k] && String(blocks[k]).length > cap) {
        return { status: 400, body: { error: `${k} is ${String(blocks[k]).length} characters; the budget is ${cap}. Cut a whole clause, don't trim one.` } };
      }
    }
    const rarity = body?.rarity && [...RANKS, 'architect'].includes(body.rarity) ? body.rarity : cur.rarity;
    const weight = body?.pool_weight != null ? Number(body.pool_weight) : cur.pool_weight;
    await query('UPDATE cards SET text_blocks=$1, rarity=$2, pool_weight=$3 WHERE id=$4',
      [JSON.stringify(blocks), rarity, weight, id]);
    invalidatePool();
    return { status: 200, body: { ok: true } };
  }

  if (one && method === 'DELETE') {
    await query('DELETE FROM cards WHERE id=$1', [Number(one[1])]);
    invalidatePool();
    return { status: 200, body: { ok: true } };
  }

  // Rebuild a card's text from its source row — for when content changed after
  // the card was struck.
  const rederive = path.match(/^\/cards\/(\d+)\/rederive$/);
  if (rederive && method === 'POST') {
    const id = Number(rederive[1]);
    const { rows } = await query('SELECT * FROM cards WHERE id=$1', [id]);
    if (!rows.length) return { status: 404, body: { error: 'No such card' } };
    const c = rows[0];
    let rebuilt = null;
    if (c.subject_type === 'npc') {
      const r = await query('SELECT * FROM npcs WHERE id=$1', [c.subject_ref]);
      if (r.rows.length) rebuilt = buildNpcCard(r.rows[0]);
    } else if (c.subject_type === 'enemy') {
      const [r, s] = await Promise.all([
        query('SELECT * FROM enemies WHERE id=$1', [c.subject_ref]),
        query('SELECT SUM(max_count) AS max_count, MIN(spawn_weight) AS spawn_weight, COUNT(*) AS zones FROM zone_spawns WHERE enemy_id=$1', [c.subject_ref]),
      ]);
      if (r.rows.length) rebuilt = buildEnemyCard(r.rows[0], s.rows[0] || {});
    }
    if (!rebuilt) return { status: 400, body: { error: 'Only NPC and enemy cards can be re-derived — a player card is a frozen moment and has no live source.' } };
    await query('UPDATE cards SET text_blocks=$1, spec=$2, power=$3 WHERE id=$4',
      [JSON.stringify(rebuilt.text_blocks), JSON.stringify(rebuilt.spec), rebuilt.power, id]);
    invalidatePool();
    return { status: 200, body: { ok: true, text_blocks: rebuilt.text_blocks } };
  }

  return null;
}

export const hooks = {
  'player.say': onSay,
  'furniture.describe': cardFurnitureDescribe,
};

// Declaration-only (handler: null) — the verbs are registered as ordinary
// commands above; these entries exist so examine's Actions row and the mobile
// smart bar know a machine affords them. A flag-VALUE gate is exactly what
// requiredFlag does, so the note that availableActions couldn't surface these
// no longer holds.
export const specializedActions = [
  { verb: 'buypack', requiredFlag: 'vends_packs', handler: null },
  { verb: 'mint',    requiredFlag: 'card_mint',   handler: null },
  { verb: 'scrap',   requiredFlag: 'card_mint',   handler: null },
];

export const commands = {
  mint: cmdMint,
  cards: cmdCards,
  buypack: cmdBuyPack,
  sleeve: cmdBuyPack,
  openpack: cmdOpenPack,
  tear: cmdOpenPack,
  scrap: cmdScrap,
};

export const _test = { getPool, invalidatePool, insertCard, grant, BUDGET, PACK_PRICE, SCRAP_VALUE };
