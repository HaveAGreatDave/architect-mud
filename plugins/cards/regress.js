// Cards regression. The budget ladder is the thing under test: a clause ladder
// that silently starts truncating is exactly the regression a text card cannot
// survive, and it has to hold for all three subject types (an enemy row with a
// 900-character description is the case that breaks it).
import { query } from '../../server/models/db.js';
import { insertFurniture } from '../../server/engine/world.js';
import {
  ladder, wholeSentences, pickQuote, BUDGET, SILENCE, rollSleeve, RANKS,
  buildNpcCard, buildEnemyCard, enemyRarity, conditionBand,
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

    // ── verbs route, and gate on furniture ───────────────────────────────────
    player.current_zone = 'zone_cards_regress_empty';
    let r = await run('mint');
    check('mint with no terminal errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
    r = await run('buypack');
    check('buypack with no machine errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));

    await insertFurniture({
      id: FURN_MINT, name: 'test mint', description: 'a test mint terminal', object_type: 'terminal',
      zone_id: Z, flags: JSON.stringify({ card_mint: true }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await insertFurniture({
      id: FURN_MACH, name: 'test card machine', description: 'a test card machine', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ vends_packs: 1 }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    player.current_zone = Z;
    r = await run('mint');
    check('mint previews before charging anything', r?.type === 'output' && /mint confirm/i.test(r.message || ''),
      JSON.stringify(r)?.slice(0, 160));
    // The preview path must not touch credits — the whole point of previewing
    // first is that nobody pays before seeing the card.
    const before = Number(player.credits) || 0;
    await run('mint');
    check('previewing costs nothing', (Number(player.credits) || 0) === before,
      `${before} -> ${player.credits}`);

    r = await run('cards');
    check('cards reads an empty shelf without throwing', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));

    r = await run('scrap');
    check('scrap with no dupes answers cleanly', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
  } finally {
    player.current_zone = saved;
    await query('DELETE FROM furniture WHERE id = ANY($1)', [[FURN_MINT, FURN_MACH]]).catch(() => {});
  }
}
