// The `kitchen` Preparation Workspace provider.
//
// This is the cooking half of the workspace HUD (plugins/workspace). It knows
// about pans, profiles, burners and thaw states; the workspace plugin knows
// none of that and never learns it. The two are joined by the
// `workspace.provider` gather-hook, not an import, so either plugin can be
// pulled without breaking the other — the same reason cooking reaches synthesis
// through an Action rather than a `require`.
//
// It contributes NO simulation. Everything below is a read of state some other
// part of cooking already owns: `checkCooking` for what stage a thing is at,
// `prepText` for what was done to it, `cooksOnAppliances` for which burner is
// lit. The panel is `mise` with structure instead of prose.
//
// Strictly DERIVED, same contract as `mise`: no writes, no clock, no session.
// Two queries per build (what you carry; what the room's boxes hold), and zero
// for appliances, power and temperature — those are in-memory world state.
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getZonePowerStatus, getZoneTemperature } from '../../server/engine/environment.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { checkCooking, cooksOnAppliances } from './cook.js';
import { profileNameFor, isMedium, HANDLING_VERB } from './profiles.js';
import { portionName, canChop } from './portions.js';
import { prepText, canMarinate } from './prep.js';
import { fondState } from './fond.js';
import { getItem } from '../../server/engine/items-cache.js';
import { DISHES, signature, ingredientLine, ingredientParts, keyNounFor, methodLines, unitsOf, ALSO, UNIT_TOLERANCE_LOW } from './dishes.js';
import { buyableExamples } from './shoplist.js';
import { whereToBuyAll } from './stockists.js';
import { cookbookState, savedRecipes, UNTRIED } from './knowledge.js';
import { gearFor, gearKeysOf } from './gear.js';

// The name the PLAYER has been shown — a per-instance `custom_data.name` (a
// butchered cut, a minced one) is what `inventory` prints, so anything reading
// the catalog name back at them is naming a different thing.
const shownName = row => row?.custom_data?.name || row?.name;

const isFood = r => !!(profileNameFor(r) || hasTag(r, 'needs_cooking') || r.custom_data?.cooking || r.custom_data?.dish);
const isVessel = r => hasTag(r, 'vessel');
// What a kitchen counts as a tool. Deliberately the same tags the cooking verbs
// themselves resolve against (`chopTool` in index.js takes either blade tag), so
// the HUD can never advertise a tool that wouldn't actually work.
const isTool = r => hasTag(r, 'can_chop') || hasTag(r, 'butchering') || hasTag(r, 'can_turn');

// Is this room a kitchen at all? Pure in-memory — no query is spent finding out
// the answer is no, which matters because `workspace` is a verb somebody will
// type in the street.
function kitchenFurniture(zoneId) {
  const furn = getZoneFurniture(zoneId);
  return {
    stoves: furn.filter(f => f.flags?.stove_tier),
    microwaves: furn.filter(f => f.flags?.microwave),
    boxes: furn.filter(f => f.object_type === 'container'),
    // A tap. Not a gate on the HUD existing — a kitchen without one is a real
    // kitchen — but `fill` needs one, so the HUD must know before it offers it.
    taps: furn.filter(f => f.flags?.water_source),
  };
}

// One component row of the payload. Phase 1 carries no actions — the HUD reads,
// it does not yet act — but the shape is the one actions will hang off.
function component(row, kind, actions = []) {
  const cd = row.custom_data || {};
  const notes = [];
  if (cd.minced) notes.push('minced');
  if (cd.portion) notes.push(portionName(cd.portion));
  const prep = prepText(cd);
  if (prep) notes.push(prep);

  let state = null;
  // The one moving thing on the panel, and the only row that carries a `cook`
  // block. It is WHICH BEAT the prose above is on — never a clock, never a
  // percentage: when to plate is the largest quality lever in the kitchen and a
  // countdown would play that half of the game for the player. `window`/`over`
  // have no beat count because there is nothing to count towards; they are a
  // state, and the state is the warning.
  let cook = null;
  if (cd.cooking) {
    const c = checkCooking(row);
    state = c?.text || null;
    if (c) cook = { phase: c.phase || null, stage: c.stage || null, stages: c.stages || null };
  }
  else if (cd.dish) state = 'a finished dish';
  else if (cd.cooked) state = 'cooked';
  else if (kind === 'food') state = 'raw';

  return {
    id: row.id,
    name: shownName(row),
    qty: Number(row.quantity) > 1 ? Number(row.quantity) : null,
    kind,
    state,
    notes,
    cook,
    // A cook in progress is the one thing on this panel that is moving, and the
    // client dims everything that isn't. Derived, never stored.
    live: !!cd.cooking,
    actions,
  };
}

const kindOf = r => (isVessel(r) ? 'vessel' : isTool(r) ? 'tool' : isFood(r) ? 'food' : null);

// ── Actions ──────────────────────────────────────────────────────────────────
//
// THE RULE: an action is a verb string a player could have typed. Nothing here
// performs anything; it composes `chop rat haunch` and hands it back, and the
// client dispatches it through the ordinary command pipeline. There is no
// second code path for any of these mechanics.
//
// The gates below are deliberately COARSE — profile family, cooked/raw state,
// whether the tool is in reach. They are not the verb's real preconditions and
// must never try to be: `score` alone checks scored/minced/on-the-heat/cooked,
// and re-deriving that here would be a second, drifting implementation of the
// thing this layer exists not to duplicate. So the HUD proposes and the VERB
// decides, exactly as it does for a player who typed it — the worst case is an
// offered action that answers "it's already scored", which is a true sentence
// and a better teacher than a hidden button.
//
// Targets are NAMES, not ids, for the same reason: the command shown is the
// command a player could type, ambiguity resolves through SIFT the way it
// always does, and reading the payload tells you the HUD can't exceed the verbs.
const act = (label, command, hint = null) => ({ label, command, hint });

function foodActions(row, ctx, { inVessel = false } = {}) {
  const cd = row.custom_data || {};
  const name = shownName(row);
  const profile = profileNameFor(row);
  const out = [];

  if (cd.cooking) {
    // Mid-cook. The handling verb is the profile's, not a guess — a soup wants
    // stirring and telling you to flip it is how you learn that the hard way.
    const wanted = HANDLING_VERB[cd.cooking.profile] || 'flip';
    if (!cd.cooking.microwave && ctx.handling[wanted]) out.push(act(wanted, `${wanted} ${name}`));
    out.push(act('taste', `taste ${name}`, 'costs you a mouthful of the finished dish'));
    out.push(act('plate', `plate ${name}`));
    return out;
  }

  if (cd.dish || cd.cooked) {
    out.push(act('eat', `eat ${name}`));
    if (ctx.blade) out.push(act('cut', `cut ${name}`, 'halves it to share'));
    out.push(act('taste', `taste ${name}`));
    return out;
  }

  // Raw. Every prep below is a TRADE, which is why none of them is a button you
  // always press — the hints say what it costs, because the panel making them
  // look free would be the panel lying about the system.
  if (profile === 'dense_meat') {
    if (!cd.scored && !cd.minced) out.push(act('score', `score ${name}`, 'wider window; dries out faster past it'));
    if (!cd.tenderised && !cd.minced) out.push(act('tenderise', `tenderise ${name}`, 'faster and forgiving; one rung off the ceiling'));
    if (!cd.minced && ctx.blade) out.push(act('mince', `mince ${name}`, 'a third of the cook; two rungs off the ceiling, forever'));
  }
  if (ctx.blade && canChop(row)) out.push(act('chop', `chop ${name}`, 'faster cook, proportionally smaller meal'));
  if (profile === 'bread' && !cd.buttered && ctx.spreadable) {
    out.push(act('butter', `butter ${name}`, 'counts as the dish fat'));
  }
  // Marinating names a second object, so the HUD can only get you as far as the
  // verb — the bath is yours to pick.
  if (canMarinate(profile) && !cd.marinated_at) {
    out.push(act('marinate…', `marinate ${name} in `, 'name what to steep it in; costs the marinade and real time'));
  }

  if (!inVessel) {
    // The line this whole HUD exists to delete. One entry per vessel in play,
    // which is why the Preparation Area is where a pan has to be before it
    // shows up here.
    for (const v of ctx.vessels) out.push(act(`→ ${v.short}`, `stow ${name} in ${v.name}`));
    if (ctx.stoves.length) out.push(act('cook', `cook ${name}`, 'bare on the heat — a vessel cooks it better'));
  }
  return out;
}

function vesselActions(v, contents, ctx) {
  const cd = v.custom_data || {};
  const name = shownName(v);
  const out = [];
  const onHeat = ctx.appliances.some(f => f.flags?.vessel_id === v.id);
  const anyCooking = contents.some(r => r.custom_data?.cooking);

  // WATER IN THE POT. The gate that dry starch now sits behind, so the HUD has
  // to be able to say so — a player holding penne, a pot and a lit stove would
  // otherwise be told "it will scorch" by a verb and nothing at all by the panel
  // that exists to stop that happening. Coarse on purpose, like every provider
  // gate here: `fill` re-checks the tap, the vessel kind and what's already in
  // there, and the HUD only proposes.
  const wet = contents.some(r => profileNameFor(r) === 'liquid');
  const kind = tagValue(v, 'vessel_kind', null);
  const boilable = kind !== 'bowl' && kind !== 'bread';
  if (boilable && ctx.taps?.length && !wet && !anyCooking) {
    out.push(act('fill', `fill ${name}`, contents.some(r => profileNameFor(r) === 'dry_starch')
      ? 'pasta and rice will not cook without it'
      : 'water from the tap, to boil in'));
  }
  if (boilable && !anyCooking && contents.some(isMedium)) {
    out.push(act('empty', `empty ${name}`, 'tips the water back out'));
  }

  if (onHeat) {
    // A stove's tier is a CEILING, not its only setting — riding the burner is
    // the single largest quality lever in the system, so it gets three flat
    // actions rather than being buried behind a submenu.
    for (const tier of ['low', 'mid', 'high']) out.push(act(tier, `stove ${tier}`));
  } else if (ctx.stoves.length && contents.length) {
    out.push(act('cook', `cook ${name}`));
  }
  if (anyCooking) {
    out.push(act('plate', `plate ${name}`, 'ends it and decides the quality'));
    if (contents.some(r => profileNameFor(r) === 'dry_starch')) out.push(act('drain', `drain ${name}`));
  }
  if (contents.length) out.push(act('taste', `taste ${name}`, 'one spoonful, however much is in it'));

  // Fond: the one place a cook can see the last one. Fresh is worth lifting;
  // dried on is worth scrubbing, and leaving it is worse than a clean pan.
  const fond = fondState(cd.fond);
  if (fond === 'fresh' && !cd.deglazed && contents.some(r => profileNameFor(r) === 'liquid')) {
    out.push(act('deglaze', `deglaze ${name}`, 'beats any seasoning — it is a technique'));
  }
  if (fond === 'residue' || (fond !== 'none' && !contents.length)) {
    out.push(act('scour', `scour ${name}`, 'a pan you browned in and ignored is worse than a clean one'));
  }
  return out;
}

// ── Recipe Assistant ─────────────────────────────────────────────────────────
//
// WHY IT ONLY EVER SHOWS RECIPES YOU KNOW.
//
// This is the constraint that shapes the whole panel, and it is not a limitation
// — it is the cookbook's rule, and breaking it here would break the system
// somewhere else. Knowing a recipe never gates cooking it; any combination
// always cooks, and DISCOVERY is what writes one down. The Cookbook app is
// deliberately blank about the half you haven't found, "because a checklist of
// exact ingredient counts would turn discovery into data entry."
//
// An Assistant that listed all 47 templates with their exact shortfalls would be
// exactly that checklist, delivered faster. So it scores what you KNOW against
// what's in the room, and says only how many others are out there — the same
// sentence the Cookbook app ends on. A player still finds new dishes the way the
// system intends: by putting things in a pan and cooking them.
//
// Pure arithmetic over a signature and the catalog. No query of its own —
// `cookbookState` costs nothing for a player whose flags are hydrated.
const range = need => (Array.isArray(need) ? need : [need, need]);
const titleFor = key => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const itemInfo = id => { try { return getItem(id); } catch { return null; } };

// ONE SHORTFALL, IN THE PIECES A LIST NEEDS.
//
// The prose line stays — the recipe card reads it, and "cooked down hard, before
// anything else goes in" is worth saying somewhere. But a MISSING list is read
// the way the Components list above it is read: down a column, noun first. So
// each shortfall also travels as a row, and the two are built from the same
// `ingredientParts` so they can't drift.
//
// `ex` is the buyable nouns, from the shopping list's own derivation rather than
// the recipe's note — the note says "tomato for the body", and a fresh tomato is
// a soft vegetable that will NOT satisfy the liquid it's describing. Everything
// named here ticks the line off when you buy it, because the test is the
// matcher's.
function shortfallRow(profile, need, template) {
  const parts = ingredientParts(profile, need, template, itemInfo);
  // A class the dish already names outright ("125g of penne") is the buyable
  // thing; listing four more starches after it would make a solved line
  // ambiguous again. Same rule the shopping list's `classLabel` applies.
  const ex = keyNounFor(template, profile, itemInfo) ? [] : buyableExamples(profile, template);
  return {
    kind: 'profile', v: profile,
    noun: parts.noun, amount: parts.amount, prep: parts.prep, note: parts.note,
    ex,
  };
}

function scoreRecipe(key, template, sig, ctx, band) {
  const also = sig[ALSO] || {};
  const missing = [];
  const shortfall = [];
  let met = 0, total = 0;

  for (const [profile, need] of Object.entries(template.needs)) {
    // The matcher's own lower bound, tolerance included, so the Assistant can
    // never say "ready" about a pan the matcher would reject — or the reverse.
    const min = range(need)[0] * UNIT_TOLERANCE_LOW;
    const have = (sig[profile] || 0) + (also[profile] || 0);
    total += 1;
    if (have >= min - 1e-9) met += 1;
    else {
      met += Math.max(0, have / min);
      missing.push(ingredientLine(profile, need, template, itemInfo));
      shortfall.push(shortfallRow(profile, need, template));
    }
  }

  // A named dish is anchored on specific items — ramen without ramen noodles is
  // soup. Those are named outright rather than described as a class.
  for (const id of template.keyItems || []) {
    total += 1;
    if (ctx.itemIds.has(id)) met += 1;
    else {
      const name = itemInfo(id)?.name || id.replace(/^item_/, '').replace(/_/g, ' ');
      missing.push(name);
      // No amount and no alternatives: a key item is one specific thing and the
      // recipe refuses without it, which is the whole reason it's keyed.
      shortfall.push({ kind: 'item', v: id, noun: name, amount: '', prep: '', note: '', ex: [] });
    }
  }

  // Equipment, from the one derivation the Cookbook card and the shopping list
  // also read. This used to test the vessel and the stove here, in its own
  // words, which was right about both and silent about the spoon — and silent in
  // a way nothing else could correct, because nothing else knew the list existed.
  //
  // Only what would BLOCK the dish bucket it as missing equipment: a spoon you
  // haven't got is a worse sauce, not a refusal, and burying a ready recipe under
  // "Missing Equipment" over one would be the panel lying about the system.
  const equipment = [], kitSoft = [], kit = [];
  for (const g of gearFor(template)) {
    const held = g.key === 'heat' ? ctx.stoves.length > 0
      : g.key.startsWith('vessel:') ? ctx.vesselKinds.has(g.kind)
      : ctx.kitTags.has(g.key);
    kit.push({ label: g.label, req: g.req, held });
    if (held) continue;
    (g.req === 'required' ? equipment : kitSoft).push(g.label);
  }

  // EXACTLY the rows `prepare` would take, from the same picker `prepare` uses.
  // This is what lets the panel highlight the onion in the fridge rather than
  // telling you a soft vegetable exists somewhere in the room.
  const chosen = ctx.pick ? ctx.pick(template) : null;
  const uses = chosen ? chosen.picks.map(r => r.id) : [];
  if (chosen?.vessel) uses.push(chosen.vessel.id);

  const pct = total ? Math.round(100 * Math.min(1, met / total)) : 100;
  return {
    key,
    name: titleFor(key),
    vessel: template.vessel || null,
    band: band === UNTRIED ? null : band,
    pct,
    missing,
    // The same shortfall as rows rather than sentences — see `shortfallRow`. The
    // `shops` on each is filled in afterwards, in one pass over the whole panel.
    shortfall,
    equipment,
    // Kit that isn't a gate. Named separately so the HUD can say "you'll want a
    // spoon" without the recipe leaving the group it belongs in.
    kitSoft,
    // The whole kit, held or not, so the opened card can show what it's made in
    // beside what it's made of.
    kit,
    uses,
    // Guidance, never a script: the player may mince what it says to dice, or
    // walk away from the recipe entirely. The whole method, not the first line
    // of it — the Cookbook app has always shown all of this and the HUD was
    // throwing the rest away.
    method: methodLines(template),
    ingredients: Object.entries(template.needs).map(([p, n]) => ingredientLine(p, n, template, itemInfo)),
    suggestion: methodLines(template)[0] || null,
    // Offered only when it would actually work. `prepare` re-validates anyway,
    // but proposing it against a recipe you're two ingredients short of would
    // be proposing a failure.
    actions: (!missing.length && !equipment.length)
      ? [{ label: 'prepare', command: `prepare ${key.replace(/_/g, ' ')}`, hint: 'gathers what it needs — you still cook it' }]
      // Short of something? Then the useful action isn't prepare, it's writing
      // down what to go and buy.
      : missing.length
        ? [{ label: '+ list', command: `shoplist add ${key.replace(/_/g, ' ')}`, hint: 'adds the shortfall to your shopping list' }]
        : [],
  };
}

const GROUPS = [
  { key: 'ready', label: 'Available Now' },
  { key: 'close', label: 'Nearly Available' },
  { key: 'short', label: 'Missing Ingredients' },
  { key: 'gear', label: 'Missing Equipment' },
];

// A saved recipe read back as something scoreRecipe understands. Its identity is
// a signature string ("pot|dense_meat:1,liquid:1") because it was DERIVED from a
// pot rather than authored, so the counts are exact rather than a range.
function savedTemplate(blob) {
  const [vessel, parts] = String(blob.sig || '').split('|');
  if (!parts) return null;
  const needs = {};
  for (const p of parts.split(',')) {
    const [name, n] = p.split(':');
    if (name) needs[name] = Number(n) || 1;
  }
  if (!Object.keys(needs).length) return null;
  return {
    needs, optional: [], keyItems: [],
    vessel: vessel === 'none' ? null : vessel,
    noun: blob.family || 'dish',
    // Nothing to derive a method from — it's your recipe, you know how it goes.
    steps: [`Yours. ${blob.family ? `A ${blob.family}` : 'A dish'} you worked out.`],
    ceiling: 'superb', difficulty: 3 + (blob.complexity || 1),
  };
}

async function buildAssistant(player, reachableFood, ctx) {
  const { known } = await cookbookState(player.id);
  const mine = await savedRecipes(player.id);
  const total = Object.keys(DISHES).length;
  if (!known.size && !mine.size) {
    return {
      groups: [],
      unknown: total,
      // The same sentence the Cookbook app ends on, for the same reason.
      note: `Nothing written down yet. Put things in a pan and cook them together — ${total} recipes exist, and nobody's going to tell you what they are.`,
    };
  }

  const sig = signature(reachableFood, profileNameFor);
  const scored = [];
  for (const [key, band] of known) {
    const t = DISHES[key];
    if (t) scored.push(scoreRecipe(key, t, sig, ctx, band));
  }
  // Your own recipes score alongside the catalog's, on the same arithmetic. A
  // saved recipe stores its signature as a string rather than a `needs` map —
  // it was derived from a pot, not authored — so it's read back into one here.
  for (const [slug, blob] of mine) {
    const t = savedTemplate(blob);
    if (!t) continue;
    const r = scoreRecipe(slug, t, sig, ctx, blob.best);
    r.name = blob.name;          // their name for it, never a title-cased slug
    r.own = true;
    // `prepare` resolves by the name the player gave it, not the slug.
    if (r.actions.length) r.actions = [{ ...r.actions[0], command: `prepare ${blob.name}` }];
    scored.push(r);
  }

  // WHERE TO BUY IT, ONCE FOR THE WHOLE PANEL.
  //
  // Every shortfall on every short recipe in one call, so the vendor index is
  // loaded once and eight recipes short of the same tomato cost what one does.
  // A failure here is a missing hint, never a missing panel: the Assistant's job
  // is to say what you're short of, and it already did that before this existed.
  try {
    const wants = [];
    for (const r of scored) for (const s of r.shortfall || []) {
      wants.push(s.kind === 'item' ? { itemId: s.v } : { profile: s.v });
      s._at = wants.length - 1;
    }
    const found = await whereToBuyAll(player, wants);
    for (const r of scored) for (const s of r.shortfall || []) {
      const hit = found[s._at] || {};
      s.shops = hit.shops || [];
      s.sold = !!hit.sold;
      delete s._at;
    }
  } catch (err) {
    console.warn('[cooking] stockist lookup failed:', err?.message || err);
    // `sold: null` is "no answer", which the panel says nothing about — distinct
    // from `false`, which is the real and useful "nobody sells this, go and
    // catch it". A broken lookup must never print that sentence.
    for (const r of scored) for (const s of r.shortfall || []) { s.shops = []; s.sold = null; delete s._at; }
  }

  const bucket = r => (r.equipment.length && !r.missing.length ? 'gear'
    : !r.missing.length ? 'ready'
    : r.missing.length === 1 ? 'close'
    : 'short');

  const groups = GROUPS.map(g => ({
    label: g.label,
    recipes: scored.filter(r => bucket(r) === g.key).sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)),
  })).filter(g => g.recipes.length);

  return {
    groups,
    unknown: total - known.size,
    note: `${known.size} of ${total} recorded${mine.size ? `, plus ${mine.size} of your own` : ''}. ${total - known.size} still out there.`,
  };
}

// One gather of everything a kitchen needs to answer any question — shared by
// the panel build and the Prepare planner, so the two can never disagree about
// what's in the room. Two queries; everything else is in-memory world state.
async function collect(player) {
  const zoneId = player.current_zone;
  const { stoves, microwaves, boxes, taps } = kitchenFurniture(zoneId);
  const appliances = [...stoves, ...microwaves];
  const boxIds = new Set(boxes.map(f => f.id));
  // `fromNearby` on the cooking verbs reaches into a `dish_cabinet` and nowhere
  // else, so a spatula in the rack counts and one in the fridge does not. The
  // HUD has to draw the same line or it advertises tools the verb can't find.
  const dishCabIds = new Set(boxes.filter(f => f.flags?.dish_cabinet).map(f => f.id));

  // ── Query 1: everything the player carries ────────────────────────────────
  const { rows: carried } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id,
            i.name, i.weight, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [player.id]
  );

  // ── Query 2: everything the room's boxes hold, and what those things hold ──
  //
  // The second half of the UNION is what makes a pot left in a cabinet legible:
  // its CONTENTS are inventory rows parented to the pot, not to the cabinet, so
  // a plain join finds the pot and stops. One statement rather than a query per
  // pot — the room is the loop, and looping it would be a round trip each.
  const { rows: stored } = boxes.length
    ? await query(
      `WITH box AS (
         SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id
           FROM player_inventory pi
           JOIN furniture f ON f.id = pi.container_id
          WHERE f.zone_id = $1 AND f.object_type = 'container'
       )
       SELECT b.id, b.item_id, b.quantity, b.custom_data, b.container_id,
              i.name, i.weight, i.tags
         FROM box b JOIN items i ON i.id = b.item_id
       UNION ALL
       SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, pi.container_id,
              i.name, i.weight, i.tags
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.container_id IN (SELECT id FROM box)`,
      [zoneId]
    )
    : { rows: [] };

  // The two queries OVERLAP, and must: a pot you left in the kitchen cabinet is
  // still owned by you, so it comes back from both. Merge by id rather than
  // concatenating, or the cabinet lists everything twice and its "+ n other
  // items" count silently doubles.
  const byId = new Map();
  for (const r of [...carried, ...stored]) if (!byId.has(r.id)) byId.set(r.id, r);
  const all = [...byId.values()];
  const childrenOf = new Map();
  for (const r of all) {
    if (!r.container_id) continue;
    if (!childrenOf.has(r.container_id)) childrenOf.set(r.container_id, []);
    childrenOf.get(r.container_id).push(r);
  }
  const vessels = all.filter(isVessel);
  const vesselIds = new Set(vessels.map(v => v.id));

  return { zoneId, stoves, microwaves, boxes, taps, appliances, boxIds, dishCabIds,
           carried, all, byId, childrenOf, vessels, vesselIds };
}

export async function buildKitchen(player) {
  const c = await collect(player);
  const { zoneId, stoves, microwaves, boxes, taps, appliances, boxIds, dishCabIds,
          carried, all, byId, childrenOf, vessels, vesselIds } = c;

  // ── What's in reach — the coarse gates the action layer reads ─────────────
  //
  // Each of these mirrors the reach of the verb it gates: `chopTool` and the
  // handling tools take `fromNearby`, so the cabinet counts; `butter` does not,
  // so it doesn't.
  const reachable = all.filter(r => !r.container_id || !boxIds.has(r.container_id) || dishCabIds.has(r.container_id));
  const has = (tag, list = reachable) => list.some(r => hasTag(r, tag));
  const ctx = {
    stoves,
    taps,
    appliances,
    blade: has('can_chop') || has('butchering'),
    spreadable: has('spreadable', carried),
    handling: { flip: has('can_turn'), stir: has('can_stir') },
    // Stow targets. A pan inside a room box isn't reachable by `stow x in y`,
    // so offering it would be offering a command that fails.
    vessels: vessels
      .filter(v => !boxIds.has(v.container_id))
      .map(v => ({ id: v.id, name: shownName(v), short: tagValue(v, 'vessel_kind', null) || shownName(v) })),
    // What the Assistant scores equipment against. Every vessel in the room
    // counts, cabinet included — this half is planning, not execution, and "you
    // own a pot, it's in the cupboard" is the answer somebody wants.
    vesselKinds: new Set(vessels.map(v => tagValue(v, 'vessel_kind', null)).filter(Boolean)),
    // Kit keys anything in REACH answers. Reach, not the room: the Assistant may
    // not count a whisk that's locked in the fridge, because `stir` couldn't
    // reach it either.
    kitTags: new Set(reachable.flatMap(r => gearKeysOf(r.tags))),
    itemIds: new Set(all.map(r => r.item_id)),
    // The one picker, shared with `prepare`. See pickFor.
    pick: t => pickFor(t, c),
  };

  // What the Assistant may count as an ingredient: raw food anywhere in reach.
  // A finished dish is a meal, and something already on the heat is spoken for —
  // counting either would promise a stew you'd have to dismantle dinner to make.
  // A MEDIUM is excluded for the same reason it never satisfies a `needs` entry
  // in the pan: a pot of tap water is not a stock you have, and counting it
  // would tell you a soup was one ingredient away when it is two.
  const reachableFood = all.filter(r =>
    isFood(r) && !isMedium(r) && !r.custom_data?.dish && !r.custom_data?.cooked && !r.custom_data?.cooking);

  const contentsOf = id => (childrenOf.get(id) || [])
    .map(r => component(r, kindOf(r) || 'food', foodActions(r, ctx, { inVessel: true })));

  // ── Preparation Area — every vessel in play, and where it is ──────────────
  //
  // "Where is the pan" is the question no examine answers, and with staging it
  // is the question that decides whether you can start the greens yet.
  const placeOf = (v) => {
    const on = appliances.find(f => f.flags?.vessel_id === v.id);
    if (on) {
      // The burner setting lives in the session's heat log, not on the stove.
      const live = cooksOnAppliances([on.id])[0];
      const heats = live?.session?.heats;
      const tier = Array.isArray(heats) && heats.length ? heats[heats.length - 1].tier : null;
      return { place: `on the ${on.name}`, heat: tier, hot: true };
    }
    const box = v.container_id ? boxes.find(f => f.id === v.container_id) : null;
    if (box) return { place: `in the ${box.name}`, heat: null, hot: false };
    if (v.container_id && byId.has(v.container_id)) return { place: 'stowed in your pack', heat: null, hot: false };
    return { place: 'in hand', heat: null, hot: false };
  };

  const area = vessels.map(v => ({
    id: v.id,
    name: shownName(v),
    ...placeOf(v),
    contents: contentsOf(v.id),
    actions: vesselActions(v, childrenOf.get(v.id) || [], ctx),
  }));
  // A pan on the heat first, then one you are holding, then the crockery — the
  // order the player's attention is actually in.
  area.sort((a, b) => (b.hot - a.hot) || (a.place === 'in hand' ? -1 : 0));

  // ── The burners with nothing on them ──────────────────────────────────────
  //
  // "Is there a ring free" is one of the questions this panel exists to answer at
  // a glance, and until now the only answer was an aggregate count at the very
  // bottom of Status — which tells you a burner is free and not WHICH, in a
  // kitchen where they cook at different tiers. A free ring is listed as what it
  // is: a place to put a pan, with no contents and nothing to do to it, because
  // every verb that uses one names the FOOD (`cook steak`), never the stove.
  const nowMs = Date.now();
  for (const f of appliances) {
    if (f.flags?.vessel_id && vesselIds.has(f.flags.vessel_id)) continue;
    if (Number(f.flags?.busy_until) > nowMs) continue;   // bare food straight on the heat
    area.push({
      id: `appliance:${f.id}`,
      name: f.name,
      place: f.flags?.stove_tier ? `free · ${f.flags.stove_tier}` : 'free',
      heat: null,
      hot: false,
      idle: true,
      contents: [],
      actions: [],
    });
  }

  // ── Components — food on you that isn't in a pan yet ──────────────────────
  // "On you" has to mean on you. A row parented to a room box came back on the
  // player query too (you still own the pot in the cabinet), and without this
  // the fridge's contents would also be listed as things in your hands.
  const onYou = r => !boxIds.has(r.container_id);

  const components = carried
    .filter(r => isFood(r) && onYou(r) && !vesselIds.has(r.container_id))
    .map(r => component(r, 'food', foodActions(r, ctx)));

  const tools = carried.filter(r => isTool(r) && onYou(r)).map(r => component(r, 'tool'));

  // ── Storage — the room's boxes ────────────────────────────────────────────
  //
  // Only what a kitchen cares about is listed, with a bare count of the rest. A
  // fridge full of beer is not a preparation component, and a HUD that listed it
  // would be an inventory screen wearing a workspace's clothes.
  const storage = boxes.map(f => {
    const inside = childrenOf.get(f.id) || [];
    // A COLD box lists only what belongs in one. A fridge is not a cupboard: the
    // reason to open it is the food that would otherwise spoil, and everything
    // else in there is noise on a panel about preparing a meal. `perishable` is
    // the preservation plugin's own tag, so the HUD and the decay clock agree
    // about what "belongs in a fridge" means.
    const cold = !!f.flags?.preserves;
    const shown = inside.filter(r => kindOf(r) && (!cold || hasTag(r, 'perishable')));
    return {
      id: f.id,
      name: f.name,
      // A furniture container carries its tags on `flags` — that's what
      // `loadContainerById` hands back as `tags`, and it's where the fridge's
      // cold tier lives.
      preserves: f.flags?.preserves ?? null,
      // Storage offers exactly one thing: get it out. `pullid` is the one
      // id-shaped command here, and it earns the exception — it is a real verb
      // the container panel already uses, and "take the onion" is genuinely
      // ambiguous when three boxes in the room hold one.
      items: shown.map(r => component(r, kindOf(r), [act('take', `pullid ${r.id}`)])),
      other: inside.length - shown.length,
    };
  }).filter(s => s.items.length || s.other);

  // ── Status — the room, as the kitchen experiences it ──────────────────────
  const powered = getZonePowerStatus(zoneId) === 'powered';
  const status = [
    { label: 'Power', value: powered ? 'ONLINE' : 'OFFLINE', state: powered ? 'ok' : 'off' },
  ];
  if (stoves.length) {
    const busy = stoves.filter(f => f.flags?.busy_until > Date.now()).length;
    status.push({
      label: 'Stove',
      value: `${stoves[0].name} · ${stoves[0].flags.stove_tier} · ${busy}/${stoves.length} in use`,
      state: busy < stoves.length ? 'ok' : 'warn',
    });
  } else {
    status.push({ label: 'Stove', value: 'NONE', state: 'off' });
  }
  if (microwaves.length) status.push({ label: 'Microwave', value: 'AVAILABLE', state: 'ok' });
  // THE TAP IS EQUIPMENT NOW. It reads as scenery until the day a pan of pasta
  // refuses to cook without it, and then it is the most important object in the
  // room — so the kitchen's own status board says whether there is one, in the
  // same breath as the stove. A kitchen with no tap is a real kitchen and is not
  // an error: it says NONE and the player goes and fills the pot next door.
  status.push(taps.length
    ? { label: 'Water', value: taps[0].name.toUpperCase(), state: 'ok' }
    : { label: 'Water', value: 'NONE', state: 'off' });
  // A zone the world cache has never heard of (a fixture, a transient waste
  // room) has no temperature to report. That is a missing status line, not a
  // failed panel.
  let tempC = null;
  try { tempC = getZoneTemperature(zoneId); } catch { tempC = null; }
  if (Number.isFinite(tempC)) status.push({ label: 'Ambient', value: `${Math.round(tempC)}°C`, state: 'ok' });

  const assistant = await buildAssistant(player, reachableFood, ctx);

  return { storage, area, components, tools, status, assistant };
}

// ── Prepare Recipe: a PLAN, never a claim ────────────────────────────────────
//
// Nothing in this game soft-locks an inventory row. Trade refuses escrow
// outright — "staged goods stay in your inventory until the swap, and the
// transaction re-validates ownership at execute" — crafting consumes at commit,
// and a storefront moves ownership rather than reserving. A reservation here
// would mean every path that moves an item had to honour it, and one that
// nobody checks is worse than none.
//
// So Prepare composes an ORDERED LIST OF ORDINARY COMMANDS and the runner walks
// it, re-validating at every step because each step IS a real command. If a
// housemate took the onion between the plan and the run, step four fails with
// the message that verb already produces and the runner stops and says so. Zero
// new state, and no way to strand an item.
//
// It stops at a loaded vessel. It does NOT cook: heat is where the skill is —
// which burner, when to turn it, when to plate — and a HUD that pressed those
// buttons would be playing the interesting half of the game for you.
// WHICH ROWS, EXACTLY, THIS RECIPE WOULD USE.
//
// One function, two callers, and that is the point: the Assistant highlights
// what `prepare` would take, and `prepare` takes what the Assistant highlighted.
// Two separate implementations of "which onion" would drift the first time
// either was tuned, and the player would be shown one thing and handed another.
//
// Greedy per profile: take rows until the requirement's own tolerance-adjusted
// floor is met, preferring what's already in your hands so the plan is as short
// as the room allows.
function pickFor(template, c) {
  const kind = template.vessel;
  const candidates = c.vessels.filter(v => !kind || tagValue(v, 'vessel_kind', null) === kind);
  // Prefer one already in hand, then one in a room box. A vessel buried in your
  // own pack is deliberately last: `pullid` can't reach into a carried
  // container, so it would be a plan step with no command behind it.
  const vessel = candidates.find(v => !v.container_id)
    || candidates.find(v => c.boxIds.has(v.container_id))
    || null;

  const used = new Set(vessel ? [vessel.id] : []);
  const pool = c.all.filter(r =>
    isFood(r) && !used.has(r.id)
    && !r.custom_data?.dish && !r.custom_data?.cooked && !r.custom_data?.cooking
    && !c.vesselIds.has(r.container_id));

  const picks = [];
  const shortfall = [];
  for (const [profile, need] of Object.entries(template.needs)) {
    const min = range(need)[0] * UNIT_TOLERANCE_LOW;
    let have = 0;
    const options = pool
      .filter(r => !used.has(r.id) && profileNameFor(r) === profile)
      // Key items first — ramen without ramen noodles is soup — then whatever is
      // already in hand.
      .sort((a, b) =>
        ((template.keyItems || []).includes(b.item_id) - (template.keyItems || []).includes(a.item_id))
        || ((a.container_id ? 1 : 0) - (b.container_id ? 1 : 0)));

    for (const r of options) {
      if (have >= min - 1e-9) break;
      used.add(r.id);
      have += unitsOf(r, profile);
      picks.push(r);
    }
    if (have < min - 1e-9) shortfall.push({ profile, need });
  }
  return { vessel, picks, shortfall };
}

function planFor(key, template, c) {
  const { vessel, picks, shortfall } = pickFor(template, c);
  if (!vessel) return { error: `You've no ${template.vessel || 'vessel'} to make that in.` };
  if (shortfall.length) {
    return { error: `You're short: ${shortfall.map(s => ingredientLine(s.profile, s.need, template, itemInfo)).join('; ')}.` };
  }

  const steps = [];
  // A pot in a cabinet has to come out before `stow x in y` can reach it —
  // which is a step, and the plan says so rather than quietly failing four
  // lines later.
  if (c.boxIds.has(vessel.container_id)) steps.push(`pullid ${vessel.id}`);
  for (const r of picks) {
    if (c.boxIds.has(r.container_id)) steps.push(`pullid ${r.id}`);
    steps.push(`stow ${shownName(r)} in ${shownName(vessel)}`);
  }

  // WATER IS A STEP. Pasta and rice will not cook without it, and `prepare`
  // stopping at a pan the stove would refuse is exactly the sort of plan that
  // teaches a player the HUD is lying to them. It stays a plain command like
  // every other step — `fill` re-checks the tap and the pan for itself, so this
  // is a proposal and not a second implementation of the gate.
  const inVessel = c.childrenOf.get(vessel.id) || [];
  const needsWater = [...picks, ...inVessel].some(r => profileNameFor(r) === 'dry_starch')
    && ![...picks, ...inVessel].some(r => profileNameFor(r) === 'liquid');
  if (needsWater && c.taps.length) steps.push(`fill ${shownName(vessel)}`);

  if (!steps.length) return { error: `Everything's already where it needs to be.` };
  return { label: titleFor(key), steps, vessel: shownName(vessel) };
}

// The provider's planner. Resolves a recipe by name against what the player
// KNOWS, for the same reason the Assistant only scores known recipes.
export async function planKitchen(player, argStr) {
  const wanted = String(argStr || '').trim().toLowerCase();
  if (!wanted) return { error: `Prepare what? Name a recipe from the workspace.` };

  const { known } = await cookbookState(player.id);
  const hit = [...known.keys()].find(k => DISHES[k]
    && (k === wanted || k.replace(/_/g, ' ') === wanted || titleFor(k).toLowerCase() === wanted));
  if (hit) return planFor(hit, DISHES[hit], await collect(player));

  // Your own recipes plan exactly the same way — a saved signature reads back
  // into a `needs` map, and from there nothing downstream knows the difference.
  const mine = await savedRecipes(player.id);
  for (const [slug, blob] of mine) {
    if (blob.name.toLowerCase() !== wanted && slug !== wanted) continue;
    const t = savedTemplate(blob);
    if (!t) break;
    const plan = planFor(slug, t, await collect(player));
    if (!plan.error) plan.label = blob.name;
    return plan;
  }

  return { error: `"${argStr}" isn't a recipe you know. The workspace lists the ones you do.` };
}

// The provider descriptor the workspace plugin gathers. `priority` is what
// settles a room that is both a kitchen and something else, the same way the
// `cook` verb already has to settle a room holding a stove and a chem lab.
export function workspaceProvider(player) {
  const { stoves, microwaves, boxes } = kitchenFurniture(player.current_zone);
  if (!stoves.length && !microwaves.length && !boxes.some(f => f.flags?.dish_cabinet)) return undefined;
  return {
    key: 'kitchen',
    label: 'PREPARATION WORKSPACE',
    priority: stoves.length ? 20 : 10,
    build: buildKitchen,
    plan: planKitchen,
  };
}
