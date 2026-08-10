// Cards regression. The budget ladder is the thing under test: a clause ladder
// that silently starts truncating is exactly the regression a text card cannot
// survive, and it has to hold for all three subject types (an enemy row with a
// 900-character description is the case that breaks it).
import { query } from '../../server/models/db.js';
import { insertFurniture } from '../../server/engine/world.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { slotsFor, slotLeft, fullestSlot, takeFromSlot, baseStock, sleeveSeed } from './machine.js';
import {
  ladder, wholeSentences, pickQuote, BUDGET, SILENCE, rollSleeve, RANKS,
  buildNpcCard, buildEnemyCard, enemyRarity, conditionBand, mulberry32,
  isHotSeed, HOT_RANK_WEIGHT, RANK_WEIGHT, fieldMarks, combatMarks,
} from './builder.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_cards_regress';
  const FURN_MINT = 'furn_cards_regress_mint';
  const FURN_MACH = 'furn_cards_regress_mach';

  try {
    // ── budgets: nothing is ever cut mid-clause ──────────────────────────────
    const long = 'x'.repeat(400);
    check('ladder drops an over-budget clause entirely',
      ladder(['short one.', long], 40) === 'short one.',
      JSON.stringify(ladder(['short one.', long], 40)));

    check('ladder returns null when a REQUIRED clause cannot fit',
      ladder([long], 40, 1) === null, 'expected null');

    const built = ladder(['aaa.', 'bbb.', 'ccc.'], 9);
    check('ladder stops rather than skipping around a clause', built === 'aaa. bbb.', String(built));

    const enemyProse = ladder([`${'A rot-hound. '.repeat(80)}`.trim()], BUDGET.lastSeen, 1);
    check('a 900-char enemy description yields null, never a slice', enemyProse === null, String(enemyProse));

    check('wholeSentences takes whole sentences only',
      wholeSentences('One. Two. Three.', 9) === 'One. Two.',
      wholeSentences('One. Two. Three.', 9));
    check('wholeSentences never returns a partial fragment',
      wholeSentences('A single enormous unbroken run of words with no stop at all', 10) === '',
      wholeSentences('A single enormous unbroken run of words with no stop at all', 10));

    // ── the quote is never edited to fit ─────────────────────────────────────
    check('pickQuote skips an over-length line and takes the next that fits',
      pickQuote(['Q'.repeat(200), 'Short enough']) === 'Short enough',
      pickQuote(['Q'.repeat(200), 'Short enough']));
    check('pickQuote falls back to silence copy', pickQuote([]) === SILENCE, pickQuote([]));
    check('pickQuote rejects command-looking text', pickQuote(['/say hi', 'Real speech']) === 'Real speech',
      pickQuote(['/say hi', 'Real speech']));
    // Combat cries and dialogue carry substitution tokens; a card is printed once
    // and never re-rendered against a scene, so a token would sit there forever.
    check('pickQuote rejects templated lines', pickQuote(['$enemy lunges at $player', 'Clean line']) === 'Clean line',
      pickQuote(['$enemy lunges at $player', 'Clean line']));
    // NPC chitchat is third-person stage direction with speech quoted inside it.
    check('pickQuote lifts the speech out of an action line',
      pickQuote(['She leans in. "Hold still."']) === 'Hold still.',
      pickQuote(['She leans in. "Hold still."']));
    check('pickQuote skips pure stage direction',
      pickQuote(['drags his rebar along the ground']) === SILENCE,
      pickQuote(['drags his rebar along the ground']));

    // ── sleeves ──────────────────────────────────────────────────────────────
    let sawSize = new Set(), allSorted = true, allGuaranteed = true;
    for (let i = 0; i < 400; i++) {
      const ranks = rollSleeve();
      sawSize.add(ranks.length);
      for (let j = 1; j < ranks.length; j++) {
        if (RANKS.indexOf(ranks[j]) < RANKS.indexOf(ranks[j - 1])) allSorted = false;
      }
      if (ranks[ranks.length - 1] === 'common') allGuaranteed = false;
    }
    check('sleeve size varies', sawSize.size > 1, [...sawSize].join(','));
    check('sleeve is always sorted worst-to-best', allSorted, 'reveal order broken');
    check('the last card is never Common (the guarantee)', allGuaranteed, 'an all-common sleeve got through');

    // A pool that can't fill a rolled rank must never quietly pay out a Common in
    // the hit slot — that would make the every-sleeve guarantee a lie.
    const { pickAtRank } = await import('./index.js');
    const thinPool = [{ id: 1, rarity: 'common' }, { id: 2, rarity: 'rare' }];
    check('an unfillable Epic steps DOWN to the best available',
      pickAtRank(thinPool, 'epic').rarity === 'rare', String(pickAtRank(thinPool, 'epic')?.rarity));
    const commonOnly = [{ id: 1, rarity: 'common' }, { id: 3, rarity: 'legendary' }];
    check('the hit slot steps UP rather than paying out a Common',
      pickAtRank(commonOnly, 'uncommon', 1).rarity === 'legendary',
      String(pickAtRank(commonOnly, 'uncommon', 1)?.rarity));

    // ── derived rarity + condition bands ─────────────────────────────────────
    check('a single-zone max_count=1 enemy is legendary',
      enemyRarity({ spawn_weight: 100, max_count: 1, zones: 1 }) === 'legendary',
      enemyRarity({ spawn_weight: 100, max_count: 1, zones: 1 }));
    check('a common spawn stays common',
      enemyRarity({ spawn_weight: 100, max_count: 6, zones: 9 }) === 'common',
      enemyRarity({ spawn_weight: 100, max_count: 6, zones: 9 }));
    check('condition bands map as durability documents', conditionBand(1) === 'pristine' && conditionBand(0.05) === 'failing',
      `${conditionBand(1)}/${conditionBand(0.05)}`);

    // ── builders survive thin rows ───────────────────────────────────────────
    const thinNpc = buildNpcCard({ id: 'npc_x', name: 'Nobody', description: 'A person.', flags: {}, sex: 'female' });
    check('an unauthored NPC still builds a card', thinNpc.rarity === 'common' && !!thinNpc.text_blocks.last_seen,
      JSON.stringify(thinNpc.text_blocks));
    check('an NPC with no quote gets silence, not a crash', thinNpc.text_blocks.quote === SILENCE, thinNpc.text_blocks.quote);

    const enemyCard = buildEnemyCard({ id: 'en_x', name: 'Thing', description: 'It is a thing.', hp_max: 40, hit: 3, dodge: 2, weapon: [{ min: 1, max: 5 }] }, { spawn_weight: 100, max_count: 4, zones: 3 });
    check('an enemy card has no portrait body', enemyCard.body === null, String(enemyCard.body));
    check('enemy power derives from combat numbers', enemyCard.power > 0, String(enemyCard.power));

    // ── field marks ──────────────────────────────────────────────────────────
    // Marks are LIFTED from the author's description, never invented, and that is
    // the property under test: a card that states a physical fact its subject's
    // own prose doesn't support is worse than a card with no marks at all.
    check('marks are lifted from the description',
      fieldMarks('A tall man with a scarred jaw and a chrome arm.') === 'tall · scarred · chromed',
      fieldMarks('A tall man with a scarred jaw and a chrome arm.'));
    check('a description with nothing physical in it yields no marks',
      fieldMarks('He is waiting for someone.') === '', fieldMarks('He is waiting for someone.'));
    // "a piercing shriek" / "piercing eyes" are everywhere in the roster. A mark
    // table that fires on them invents a nose ring for half the world.
    check('common prose does not trip a false mark',
      fieldMarks('Her piercing gaze follows you across the room.') === '',
      fieldMarks('Her piercing gaze follows you across the room.'));
    check('marks never exceed their budget, and never cut one in half',
      (() => {
        const m = fieldMarks('A towering, scarred, chromed, limping, filthy, bald, mutated wreck of a man.');
        return m.length <= BUDGET.marks && !m.endsWith('·') && !m.endsWith(' ');
      })(), fieldMarks('A towering, scarred, chromed, limping, filthy, bald, mutated wreck of a man.'));
    check('no mark carries a gendered pronoun',
      !/\b(him|her|his|hers|he|she)\b/i.test(fieldMarks('A filthy, scarred, stooped, rasping man.')),
      fieldMarks('A filthy, scarred, stooped, rasping man.'));
    // An enemy's physique is its stat line, so its numbers lead its marks.
    check("an enemy's marks lead with its combat shape",
      combatMarks({ hp_max: 80, dodge: 0, hit: 5 }, 20).join('|') === 'takes a beating|slow, and knows it',
      combatMarks({ hp_max: 80, dodge: 0, hit: 5 }, 20).join('|'));
    check('a fast, fragile enemy reads as one',
      combatMarks({ hp_max: 10, dodge: 6, hit: 3 }, 6).join('|') === 'goes down easy|hard to lay hands on',
      combatMarks({ hp_max: 10, dodge: 6, hit: 3 }, 6).join('|'));
    check('all three subject types can carry marks',
      typeof buildNpcCard({ id: 'n', name: 'N', description: 'A bald, stooped woman.', flags: {} }).text_blocks.marks === 'string'
      && typeof buildEnemyCard({ id: 'e', name: 'E', description: 'A rotting thing.', hp_max: 30, hit: 2, dodge: 2, weapon: [] }, {}).text_blocks.marks === 'string',
      'a builder dropped the marks region');

    // ── verbs route, and gate on furniture ───────────────────────────────────
    player.current_zone = 'zone_cards_regress_empty';
    let r = await run('mint');
    check('mint with no terminal errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
    r = await run('buypack');
    check('buypack with no machine errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));

    await insertFurniture({
      id: FURN_MINT, name: 'test mint', description: 'a test mint terminal', object_type: 'terminal',
      zone_id: Z, flags: JSON.stringify({ card_mint: true, click_cmd: 'mint' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await insertFurniture({
      id: FURN_MACH, name: 'test card machine', description: 'a test card machine', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ vends_packs: 1, click_cmd: 'buypack' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    player.current_zone = Z;

    // ── the machine's window: on examine, not welded into the room ───────────
    // Both halves matter. A room description carrying a block of cabinet art is
    // the clutter this moved to fix; and the control has to be a `cmd` link,
    // because the click handler bails on an empty data-target and the BUY button
    // silently did nothing for as long as it was one.
    const look = await run('look');
    check('the machine does not paint a panel into the room description',
      !/cardmach/.test(look?.message || ''), (look?.message || '').slice(0, 160));
    // The click is the way in: every shipped machine carries
    // `flags.click_cmd: buypack`, so its room-list entry opens the machine's
    // real face instead of printing a second drawing of the cabinet into the
    // log. The engine seam itself is covered in tests/regress.js (layer 2) —
    // this fixture zone isn't in the world map, so `look` can't be read here.
    r = await run('examine test card machine');
    check('examining the machine no longer redraws the product window',
      !/cardmach-win/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 200));
    check('the BUY control sends a verb, not an empty target',
      /data-action="cmd"\s+data-cmd="buypack"/.test(r?.message || '') &&
      !/data-target=""/.test(r?.message || ''), (r?.message || '').slice(0, 300));

    r = await run('examine test mint');
    check('examining the mint offers PREVIEW as a cmd link',
      /data-action="cmd"\s+data-cmd="mint"/.test(r?.message || ''), (r?.message || '').slice(0, 300));

    r = await run('mint');
    check('mint previews before charging anything', r?.type === 'card_mint_open' && /mint confirm/i.test(r.message || ''),
      JSON.stringify(r)?.slice(0, 160));
    check('the preview carries the record as well as the press',
      typeof r?.face === 'string' && r.face.length > 0 && typeof r?.message === 'string' && r.message.length > 0,
      JSON.stringify(Object.keys(r || {})));
    // The preview path must not touch credits — the whole point of previewing
    // first is that nobody pays before seeing the card.
    const before = Number(player.credits) || 0;
    await run('mint');
    check('previewing costs nothing', (Number(player.credits) || 0) === before,
      `${before} -> ${player.credits}`);

    // ── the written quote ────────────────────────────────────────────────────
    // A composed line is held to the SAME gate as an overheard one. These four
    // cases are the gate: nothing is silently trimmed, nothing token-bearing
    // gets through, and a refusal happens BEFORE any money moves.
    r = await run(`mintquote ${'x'.repeat(200)}`);
    check('an over-budget quote is refused, not trimmed', r?.type === 'error' && /characters/.test(r.message || ''),
      JSON.stringify(r)?.slice(0, 160));
    r = await run('mintquote Hold still, $enemy.');
    check('a quote carrying a substitution token is refused', r?.type === 'error',
      JSON.stringify(r)?.slice(0, 160));
    r = await run('mintquote I have made a terrible mistake and I would do it again.');
    check('a good quote is accepted', r?.type === 'output' && /will read/.test(r.message || ''),
      JSON.stringify(r)?.slice(0, 160));
    r = await run('mint');
    check('the written quote lands on the previewed card',
      /I would do it again/.test(r?.face || ''), (r?.face || '').slice(0, 200));
    check('and the panel reports it as written rather than overheard', r?.quoteIsWritten === true,
      JSON.stringify({ q: r?.quote, w: r?.quoteIsWritten }));
    r = await run('mintquote clear');
    check('a quote can be cleared', r?.type === 'output' && /cleared/i.test(r.message || ''),
      JSON.stringify(r)?.slice(0, 120));
    r = await run('mint');
    check('cleared, the card stops carrying it', !/I would do it again/.test(r?.face || ''),
      (r?.face || '').slice(0, 200));

    // ── the price floor ──────────────────────────────────────────────────────
    // Scrap is the floor under the pack price: a near-complete shelf pulls mostly
    // duplicates, so a sleeve's worst case is `size × SCRAP_VALUE` straight back
    // out. If that ever reaches the price, buying packs forever becomes the
    // correct play and the machine is a money printer. The 9-card mis-cut is the
    // fattest sleeve the roller can produce, so it is the case to test.
    const { _test: cardConsts } = await import('./index.js');
    check('a full-dupe sleeve can never pay for itself, even at max size',
      9 * cardConsts.SCRAP_VALUE < cardConsts.PACK_PRICE,
      `9 × ₵${cardConsts.SCRAP_VALUE} = ₵${9 * cardConsts.SCRAP_VALUE} vs ₵${cardConsts.PACK_PRICE}`);

    // ── the machine is a panel, and buying is a separate act ─────────────────
    // `buypack` used to charge and reveal in one breath. It now opens the
    // terminal, which must cost nothing — the panel is the thing you read the
    // price off, so a player who opens it and walks away has to be untouched.
    const creditsBefore = Number(player.credits) || 0;
    r = await run('buypack');
    check('buypack opens the machine panel rather than transacting',
      r?.type === 'cardmach_panel', JSON.stringify(r)?.slice(0, 160));
    check('opening the machine costs nothing', (Number(player.credits) || 0) === creditsBefore,
      `${creditsBefore} -> ${player.credits}`);
    check('the panel carries the price, balance and pool it renders',
      r?.price > 0 && r?.credits != null && r?.pool && typeof r.pool.total === 'number',
      JSON.stringify(r)?.slice(0, 200));

    // ── the coils ────────────────────────────────────────────────────────────
    // Picking a slot is the machine's whole sense of control, so the contract is
    // that the panel ships REAL stock, an empty coil refuses, and the refusal is
    // free. A slot that could be clicked but not bought — or bought but not
    // clicked — is the bug this covers.
    const mach = { id: FURN_MACH };
    check('the panel ships nine coils with counts',
      Array.isArray(r?.slots) && r.slots.length === 9 && r.slots.every(s => s.code && typeof s.left === 'number'),
      JSON.stringify(r?.slots)?.slice(0, 200));
    check('a machine is never entirely bare on a fresh day',
      (r?.slots || []).some(s => s.left > 0), JSON.stringify(r?.slots)?.slice(0, 200));

    const day = getGameDateTime().date;
    check('stock is DERIVED, so two reads of the same machine/day agree',
      JSON.stringify(slotsFor(mach, day)) === JSON.stringify(slotsFor(mach, day)), 'stock drifted between reads');
    check('a different machine gets a different face',
      JSON.stringify(slotsFor(mach, day)) !== JSON.stringify(slotsFor({ id: 'furn_other_mach' }, day)),
      'every machine looks identical');

    // An empty coil must refuse BEFORE any money moves. This is the one ordering
    // that matters: charge-then-check would sell a sleeve out of a bare column.
    const empty = slotsFor(mach, day).find(s => s.left === 0);
    if (empty) {
      const cr = Number(player.credits) || 0;
      r = await run(`buypack confirm ${empty.code}`);
      check('an empty coil refuses', r?.type === 'error', JSON.stringify(r)?.slice(0, 140));
      check('a refused coil costs nothing', (Number(player.credits) || 0) === cr, `${cr} -> ${player.credits}`);
    }
    r = await run('buypack confirm ZZ9');
    check('a nonsense coil code falls back rather than crashing',
      r?.type === 'cardmach_vend' || r?.type === 'error', JSON.stringify(r)?.slice(0, 140));

    // The offer to tear it NOW has to reach a player who bought by TYPING — they
    // never see the cabinet's buttons, so a panel-only offer is half a feature.
    // It must stay an offer: a vend that opened the sleeve itself would destroy
    // the only reason the roll happens at the tear.
    if (r?.type === 'cardmach_vend') {
      check('the vend offers to open it, clickably',
        /data-cmd="openpack"/.test(String(r.message || '')), String(r.message || '').slice(0, 200));
      check('...but vending never opens the sleeve itself',
        r.type !== 'cardpack_open' && !r.cards, JSON.stringify(r)?.slice(0, 140));
    }

    // ── the coil decides the sleeve ──────────────────────────────────────────
    // This is the property the whole feature rests on: a sleeve's contents are
    // fixed when it is loaded, so the player's physical choice has real input on
    // the result. If a seed ever stopped reproducing its sleeve, choosing would
    // silently go back to being decorative and nothing would look broken.
    const seedA = sleeveSeed('furn_seed_mach', '2026-01-01', 'A1', 0);
    check('the same coil, same depth, gives the same seed',
      seedA === sleeveSeed('furn_seed_mach', '2026-01-01', 'A1', 0), `${seedA}`);
    check('a different coil gives a different seed',
      seedA !== sleeveSeed('furn_seed_mach', '2026-01-01', 'B2', 0), 'coils share an outcome');
    check('the next sleeve down the same coil is a different sleeve',
      seedA !== sleeveSeed('furn_seed_mach', '2026-01-01', 'A1', 1), 'a coil pays out identically forever');

    const seeded = rollSleeve(mulberry32(seedA));
    check('a seed rebuilds its sleeve exactly',
      JSON.stringify(seeded) === JSON.stringify(rollSleeve(mulberry32(seedA))), JSON.stringify(seeded));
    // A sleeve is only a SORTED list of ranks, so two unrelated seeds landing on
    // the same list is ordinary, not suspicious — comparing one seed against its
    // neighbour is a coin flip and used to go red on its own. What actually has
    // to hold is that the seed still drives the outcome across the range, so we
    // count distinct sleeves over a fixed span: constant or near-constant output
    // is the failure, and a fixed span means this can never flake.
    const spread = new Set();
    for (let i = 0; i < 200; i++) spread.add(JSON.stringify(rollSleeve(mulberry32(seedA + i))));
    check('...and the seed still drives the sleeve across a span of them',
      spread.size >= 20, `only ${spread.size} distinct sleeves in 200 seeds`);
    // A seeded roller has to obey every guarantee an unseeded one does, or a
    // bought sleeve could break the rules a typed one can't.
    let seededSorted = true, seededGuaranteed = true;
    for (let i = 0; i < 300; i++) {
      const rr = rollSleeve(mulberry32(sleeveSeed('m', 'd', 'A1', i)));
      for (let j = 1; j < rr.length; j++) if (RANKS.indexOf(rr[j]) < RANKS.indexOf(rr[j - 1])) seededSorted = false;
      if (rr[rr.length - 1] === 'common') seededGuaranteed = false;
    }
    check('a seeded sleeve is still sorted worst-to-best', seededSorted, 'reveal order broken under a seed');
    check('a seeded sleeve still never ends on a Common', seededGuaranteed, 'the guarantee broke under a seed');
    // ── the hot run ──────────────────────────────────────────────────────────
    // Occasional, seeded, and INVISIBLE until the tear. The two things that can
    // break it silently: hotness drifting for a seed (so the same sleeve is hot
    // one day and not the next), and asking whether a sleeve is hot perturbing
    // the sleeve it then rolls — which would make the question part of the answer.
    check('hotness is fixed by the seed', isHotSeed(seedA) === isHotSeed(seedA), 'a sleeve changed its mind');
    const beforeAsk = rollSleeve(mulberry32(seedA));
    isHotSeed(seedA); isHotSeed(seedA);
    check('asking whether a sleeve is hot does not change the sleeve',
      JSON.stringify(rollSleeve(mulberry32(seedA))) === JSON.stringify(beforeAsk), 'the question moved the answer');

    let hotCount = 0;
    for (let i = 0; i < 4000; i++) if (isHotSeed(sleeveSeed('m2', 'd2', 'A1', i))) hotCount++;
    check('a hot run is occasional, not rare-to-the-point-of-myth or common',
      hotCount / 4000 > 0.04 && hotCount / 4000 < 0.13, `${(hotCount / 4000 * 100).toFixed(1)}%`);
    check('hot weights triple epic and legendary and touch nothing else',
      HOT_RANK_WEIGHT.epic === RANK_WEIGHT.epic * 3 && HOT_RANK_WEIGHT.legendary === RANK_WEIGHT.legendary * 3
      && HOT_RANK_WEIGHT.common === RANK_WEIGHT.common && HOT_RANK_WEIGHT.rare === RANK_WEIGHT.rare,
      JSON.stringify(HOT_RANK_WEIGHT));

    // The point of a hot sleeve is that it actually pays better. Measured, not
    // assumed — a weights table that never reached the roller would look right.
    const topRate = (weights) => {
      let top = 0, cards = 0;
      for (let i = 0; i < 3000; i++) {
        for (const r of rollSleeve(mulberry32(sleeveSeed('m3', 'd3', 'B2', i)), weights)) {
          cards++; if (r === 'epic' || r === 'legendary') top++;
        }
      }
      return top / cards;
    };
    const cold = topRate(RANK_WEIGHT), warm = topRate(HOT_RANK_WEIGHT);
    check('a hot sleeve really does pay epic/legendary far more often',
      warm > cold * 2, `${(cold * 100).toFixed(2)}% -> ${(warm * 100).toFixed(2)}%`);
    check('...and still never ends on a Common',
      Array.from({ length: 300 }, (_, i) => rollSleeve(mulberry32(sleeveSeed('m4', 'd4', 'C3', i)), HOT_RANK_WEIGHT))
        .every(r => r[r.length - 1] !== 'common'), 'the guarantee broke on a hot sleeve');

    check('takeFromSlot hands back the identity the row has to store',
      (() => { const t = takeFromSlot({ id: 'furn_seed_take' }, day, fullestSlot({ id: 'furn_seed_take' }, day));
        return t && t.coil && typeof t.seed === 'number' && typeof t.depth === 'number'; })(),
      'a taken sleeve came back without its seed');

    // Taking from a coil has to actually deplete it, or the stack drawn behind
    // the glass is decoration and "3 LEFT" is a lie. Run on a machine id nothing
    // else in this suite buys from — the assertion is about ONE coil moving, so
    // it can't share a ledger with the purchases above.
    const stockMach = { id: 'furn_cards_regress_stock' };
    const target = fullestSlot(stockMach, day);
    const beforeLeft = slotLeft(stockMach, day, target);
    takeFromSlot(stockMach, day, target);
    check('taking a sleeve depletes that coil', slotLeft(stockMach, day, target) === beforeLeft - 1,
      `${beforeLeft} -> ${slotLeft(stockMach, day, target)}`);
    check('and leaves the other coils alone',
      slotsFor(stockMach, day).filter(s => s.code !== target)
        .every(s => s.left === baseStock(stockMach.id, day, s.code)), 'a neighbouring coil moved');

    // The sleeve is an inventory row, and the roll happens at the TEAR. With no
    // sleeve there is nothing to roll, and nothing may be granted.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, 'card_foil_sleeve']).catch(() => {});
    const shelfBefore = await query('SELECT COUNT(*)::int AS n FROM card_holdings WHERE player_id=$1', [player.id]).catch(() => ({ rows: [{ n: 0 }] }));
    r = await run('openpack');
    check('openpack with no sleeve errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 140));
    const shelfAfter = await query('SELECT COUNT(*)::int AS n FROM card_holdings WHERE player_id=$1', [player.id]).catch(() => ({ rows: [{ n: 0 }] }));
    check('a failed openpack grants nothing', shelfAfter.rows[0].n === shelfBefore.rows[0].n,
      `${shelfBefore.rows[0].n} -> ${shelfAfter.rows[0].n}`);

    r = await run('cards');
    check('cards reads an empty shelf without throwing', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));

    r = await run('scrap');
    check('scrap with no dupes answers cleanly', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
  } finally {
    player.current_zone = saved;
    await query('DELETE FROM furniture WHERE id = ANY($1)', [[FURN_MINT, FURN_MACH]]).catch(() => {});
  }
}
