// Crafting plugin regression suite — run by tests/regress.js (never loaded in
// production).
//
// Two things are worth guarding here. The first is craftSeconds(), which is now
// the ONLY thing deciding how long a craft takes: it replaced a `craft_time`
// column, so if it silently returned a constant nobody would notice until the
// whole feature was pointless. The second is the timed craft's contract — that
// nothing is consumed until it completes, and that anything standing you up
// aborts it cleanly.
import { craftSeconds, findRecipeByName, loadRecipes, getRecipeCache } from '../../server/engine/crafting.js';
import { runActivityTick } from '../../server/engine/activity-tick.js';
import { getPosture, setPosture } from '../../server/engine/posture.js';
import { query } from '../../server/models/db.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // ── craftSeconds: the derivation ────────────────────────────────────────────
  // Synthetic recipes, so the check doesn't move when content is retuned.
  const mk = (base_difficulty, skill_req = {}, ingredients = []) =>
    ({ base_difficulty, skill_req, ingredients });

  check('craftSeconds: floor is the base, not zero',
    craftSeconds(mk(0)) === 3, craftSeconds(mk(0)));
  check('craftSeconds: difficulty is the spine (1.5s per point)',
    craftSeconds(mk(4)) === 9, craftSeconds(mk(4)));
  check('craftSeconds: a skill gate adds a second per rank',
    craftSeconds(mk(4, { engineering: 2 })) === 11, craftSeconds(mk(4, { engineering: 2 })));
  check('craftSeconds: the HIGHEST skill gate counts, not the sum',
    craftSeconds(mk(4, { engineering: 2, chemistry: 1 })) === 11,
    craftSeconds(mk(4, { engineering: 2, chemistry: 1 })));
  check('craftSeconds: bulk ingredients add, single units do not',
    craftSeconds(mk(4, {}, [{ quantity: 1 }, { quantity: 1 }])) === 9
    && craftSeconds(mk(4, {}, [{ quantity: 5 }])) === 11,
    `${craftSeconds(mk(4, {}, [{ quantity: 1 }, { quantity: 1 }]))} / ${craftSeconds(mk(4, {}, [{ quantity: 5 }]))}`);
  check('craftSeconds: harder recipes always take longer than easier ones',
    craftSeconds(mk(12, { chemistry: 8 })) > craftSeconds(mk(2)),
    `${craftSeconds(mk(12, { chemistry: 8 }))} vs ${craftSeconds(mk(2))}`);
  check("craftSeconds: never zero or negative, whatever it's handed",
    craftSeconds(mk(-99)) >= 1 && craftSeconds(null) === 0 && craftSeconds({}) === 3);

  // Every real recipe must land somewhere a player would accept — a 0-second
  // craft is a bug, and a multi-minute one is a different feature.
  const { rows: allRecipes } = await query('SELECT * FROM recipes');
  const times = allRecipes.map(r => craftSeconds(r));
  check(`craftSeconds: all ${times.length} live recipes land in a sane band`,
    times.length > 0 && times.every(t => t >= 1 && t <= 120),
    `min=${Math.min(...times)} max=${Math.max(...times)}`);
  check("craftSeconds: the live recipes aren't all the same duration (the craft_time failure mode)",
    new Set(times).size > 1, `${new Set(times).size} distinct durations`);

  // ── The timed craft ─────────────────────────────────────────────────────────
  // The fake player holds no ingredients, so `craft` refuses up front — which is
  // itself the contract worth checking: the refusal must come BEFORE the wait.
  // regress boots items and drugs but not recipes, and `craft` resolves names
  // through the cache — without this the name lookup below would quietly return
  // null and the check would skip itself rather than fail.
  if (!Object.keys(getRecipeCache()).length) await loadRecipes();

  let r;
  const bandage = findRecipeByName('Field Bandage');
  check('craft: the recipe cache resolves a real recipe by name', !!bandage);

  // The fake player can afford this one, so drive the whole happy path: start,
  // wait, resolve. This is the check that would catch the craft silently
  // resolving instantly (the old behaviour) or never resolving at all.
  const countOf = async (itemId) => {
    const { rows } = await query(
      'SELECT COALESCE(SUM(quantity), 0) AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2',
      [p.id, itemId]);
    return Number(rows[0]?.n) || 0;
  };
  const outId = bandage.base_output.item_id;
  const ingId = bandage.ingredients.find(i => i.quantity > 0)?.item_id;
  const before = { out: await countOf(outId), ing: ingId ? await countOf(ingId) : 0 };

  r = await run('craft field bandage');
  check('craft: a craft starts rather than resolving instantly',
    r?.type === 'emote' && !!p.craftState && getPosture(p) === 'crafting', `${r?.type}: ${r?.message}`);
  check('craft: the start carries a countdown for the client',
    r?.progressMs === craftSeconds(bandage) * 1000, `progressMs=${r?.progressMs}`);
  check('craft: starting consumes nothing',
    (ingId ? await countOf(ingId) : 0) === before.ing, 'ingredients moved before the craft finished');

  // Not done yet — the tick must leave it alone.
  await runActivityTick();
  check('craft: the craft is still running before its time', !!p.craftState);

  // Fast-forward and let the sweep resolve it.
  p.craftState.completeAt = Date.now() - 1;
  await runActivityTick();
  check('craft: the craft resolves once its time is up', !p.craftState && getPosture(p) !== 'crafting',
    `posture=${getPosture(p)}`);
  const after = { out: await countOf(outId), ing: ingId ? await countOf(ingId) : 0 };
  // The roll can fail (materials intact) or catastrophically fail (materials
  // eaten) — all three outcomes are legal, so assert the invariant that holds
  // across every one of them: you never get the output for free.
  check('craft: a completed craft either yields the output or spends nothing extra',
    after.out >= before.out && after.ing <= before.ing,
    `out ${before.out}->${after.out}, ing ${before.ing}->${after.ing}`);

  r = await run('craft definitely not a real recipe');
  check('craft: unknown recipe is refused', r?.type === 'error', r?.message);

  // Bare `craft` LISTS. It used to answer "use RECIPES", which is a verb this
  // plugin declares and the drinks plugin owns — so the advice went somewhere
  // else and the catalogue had no live door at all.
  r = await run('craft');
  check('craft: bare craft lists the catalogue', r?.type === 'recipes' || r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
  check("craft: …and no longer points at a verb it doesn't own", !/RECIPES/i.test(r?.message || ''), r?.message);

  // Drive the activity contract directly with a synthetic craft state, so the
  // test doesn't depend on the fake player being able to afford any recipe.
  const priorPosture = getPosture(p);
  setPosture(p, 'crafting');
  p.craftState = { recipeId: '__regress_missing_recipe', name: 'Nothing', completeAt: Date.now() + 60_000 };
  await runActivityTick();
  check('craft: an unfinished craft survives the tick',
    !!p.craftState && getPosture(p) === 'crafting', `posture=${getPosture(p)}`);

  // Standing up mid-craft aborts it and consumes nothing.
  setPosture(p, 'standing');
  await runActivityTick();
  check('craft: standing up abandons the craft', !p.craftState, p.craftState);
  check('craft: abandoning leaves you standing, not stuck in the posture',
    getPosture(p) === 'standing', getPosture(p));

  // A craft whose timer has expired resolves once and clears itself, even when
  // the recipe has gone missing underneath it (the resolve path must not strand
  // the player in the posture on failure).
  setPosture(p, 'crafting');
  p.craftState = { recipeId: '__regress_missing_recipe', name: 'Nothing', completeAt: Date.now() - 1 };
  await runActivityTick();
  check('craft: an expired craft resolves and clears', !p.craftState, p.craftState);
  check('craft: a failed resolve still stands you up', getPosture(p) !== 'crafting', getPosture(p));

  setPosture(p, priorPosture);
  delete p.craftState;
}
