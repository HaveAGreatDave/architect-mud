// THE LONG HAUL — THE BENCH.
//
// `rig` and everything behind it: repair, parts, spares, the roadside strip, tune, kit, paint,
// trim, fittings, the hose, the pump and the signwriter. One verb with subcommands rather than
// eleven verbs, for the reason set out on `cmdRig` below — `repair`, `tune`, `modify`, `paintset`
// and `strip` are every one of them already owned by somebody else.
//
// ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────
//
// index.js was 4,359 lines holding two jobs with nothing in common but a truck. One is the
// telemetry path — `trucksync` reconciling a client sim four times a second, `truckevent`, the
// park/arrive transitions — which is hot, is driven by a packet rather than a person, and is where
// a mistake costs somebody a haul. The other is this: a shop counter, driven by a player standing
// still in a yard, where the worst case is a wrong price. Different tempos, different blast radius,
// and no reason for either to be read past to reach the other.
//
// ⚠ THE VERB TABLE ITSELF DID NOT MOVE, AND COULD NOT USEFULLY. It is 38 lines of one-line entries
// bound to handlers all over index.js; lifting only the table would save nothing and would need the
// import edge to run both ways for no gain. What is worth moving is the WORK behind a verb, and
// this is the largest cluster of it that comes away in one piece.
//
// ⚠ AND IT IMPORTS BACK FROM index.js, WHICH IS DELIBERATE AND HAS PRECEDENT. `plugins/injury/`
// does exactly this (`enemy.js` imports `severityFor` from its own index.js), as does
// `plugins/synthesis/workspace.js`. The rule this repo actually holds is that a cycle must not
// cross a PLUGIN boundary — voidwalking and trucking meet through registration for that reason —
// and a plugin's own modules are one unit. Everything imported below is read inside a function
// body, never at module scope, so the partially-evaluated namespace is never observed.
//
// What it needs from index.js is small and is all about the yard as a PLACE: which depot you are
// standing in, which zones that depot covers, which of your trucks you meant — and `repush`, the
// one that matters. Every subcommand here ends by asking the depot panel to redraw, because a
// bench command that changes a truck and leaves the screen showing the old numbers is the bug the
// whole panel pass exists to kill.

import { getZone } from '../../server/engine/world.js';
import { damageOf, overall, PARTS, PART_LABELS, partBand, isBroken, isCosmetic, PART_ITEMS, PART_SHARE, COSMETIC_MUL, BROKEN_AT } from './damage.js';
import { grimeOf, grimeBand, washCost } from './filth.js';
import { FITTINGS, FIT_IDS, SLOTS, installedFits, fitInSlot, priceFor } from './fittings.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { randomUUID } from 'crypto';
import { HITCH_MPH } from '../../client/game/js/panels/flight-model.js';
import { trucksAt, getTruck, setCondition, saveTruckData, setFuel } from './fleet.js';
import { TUNE_PARAMS, KITS, bandOf, tuneRange, clampTune, installedKits, effTruckParams, repairCost, FIELD_CAP, sanitizePaint, paintCost, FLASHES, FINISHES, ARTS, PAINT_PRESETS, presetPaint, SPARES_ITEM, DASH_MATERIALS, DASH_COLOURWAYS, sanitizeTrim, isDashMaterial, isDashColourway, trimCost, sanitizeCustomTrim, isTrimHex, CUSTOM_COL } from './rig.js';
import { stockTrim } from '../../client/shared/cab-trim.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { rigOf, pumpAt, FUEL_FULL } from './state.js';
import { wreckNear } from './corridor.js';
import { say, cap, depotHere, depotZonesOf, yardIdOf, whichTruckLine, repush } from './index.js';
// ── rig: the bench ───────────────────────────────────────────────────────────
// Repair, tune, kit, paint and pump, behind ONE verb with subcommands rather than five verbs.
// That is not tidiness: `repair`, `tune`, `modify` and `paintset` are all already owned — by the
// engine's gear repair, by broadcast, and by flight — and a sixth claimant on `repair` would be a
// dispatch-order puzzle for anybody who ever stood in a hangar holding a broken coat. `rig` is a
// word this system owns outright, and every button on the bench sends one of these strings.
//
// EVERY SUBCOMMAND ENDS AT THE PANEL. See `repush` — a bench command that changes a truck and
// leaves the screen showing the old numbers is the bug this whole pass exists to kill.
async function cmdRig(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const { bay, depot } = depotHere(player);
  if (!depot) return say('You would need to be at a depot. The benches are in the yards.');
  const rest = args.slice(1);

  // SPARES ARE SOLD BEFORE THE TRUCK IS RESOLVED, and that is not an ordering accident. Every other
  // subcommand is work done ON a machine and rightly refuses without one parked here; a box of
  // spares is stock off a shelf, and needing a truck present to buy the thing you buy so you can
  // rescue a truck that is NOT present would be exactly backwards.
  if (sub === 'spares') return await rigSpares(player, rest[0]);

  // Which truck. The panel always names it explicitly (its buttons carry the id as the first token
  // after the subcommand), and a player typing never does — so an unnamed one means "the one
  // standing here", which at a depot is unambiguous by the one-truck-per-yard rule.
  const idArg = rest[0] && /^truck_[0-9a-f]+$/i.test(rest[0]) ? rest.shift() : null;
  // ⚠ AN ID, NEVER A NAME, and that is not an oversight. Everything after the subcommand here is
  // an ARGUMENT — `rig paint red`, `rig trim walnut` — so a truck picked by plate would be a plate
  // competing with a colourway for the same token, and the loser is somebody who called their truck
  // Walnut. The panel always sends the id; a player with two trucks in one yard gets the menu below
  // and every line of it is typable.
  const parked = idArg ? [] : await trucksAt(player.id, depotZonesOf(bay, depot));
  const truck = idArg ? await getTruck(idArg, player.id) : (parked.length === 1 ? parked[0] : null);
  if (!truck && parked.length > 1) return whichTruckLine(`rig ${sub}`, parked, null, true);
  if (!truck) return say(idArg ? "That isn't one of yours." : 'You have nothing parked here to work on.');
  if (rigOf(player)?.truckId === truck.id) return say("Climb down first — nobody works on a truck they're sitting in.");
  const cd = truck.custom_data || {};

  if (sub === 'strip') return await rigStrip(player);
  if (sub === 'parts') return await rigParts(player, rest[0]);
  if (sub === 'repair') return await rigRepair(player, truck, cd, rest[0], rest[1] || (PARTS.includes((rest[0]||'').toLowerCase()) ? rest[0] : null));
  if (sub === 'tune') return await rigTune(player, truck, cd, rest);
  if (sub === 'kit') return await rigKit(player, truck, cd, rest[0]);
  if (sub === 'paint') return await rigPaint(player, truck, cd, rest);
  if (sub === 'trim' || sub === 'interior') return await rigTrim(player, truck, cd, rest);
  if (sub === 'fit' || sub === 'fittings') return await rigFit(player, truck, cd, rest.join(' '));
  if (sub === 'unfit') return await rigUnfit(player, truck, cd, rest.join(' '));
  if (sub === 'wash') return await rigWash(player, truck, cd);
  if (sub === 'fuel') return await rigFuel(player, truck, bay, depot);
  if (sub === 'name') return await rigName(player, truck, rest.join(' '));
  return say('<span class="text-dim">rig fit [&lt;fitting&gt;|&lt;place&gt;|all] | rig unfit &lt;fitting|place&gt; | rig wash | rig repair [shop] [engine|wheels|body] | rig strip | rig parts &lt;engine|wheels|body&gt; | rig spares [n] | rig tune &lt;gearing&gt; &lt;boost&gt; &lt;suspension&gt; &lt;brakes&gt; | rig kit &lt;id&gt; | rig paint [preset &lt;name&gt;|base=… trim=… hw=… deck=… bright=… glow=… glass=… flash=… finish=… art=…] | rig trim [&lt;material&gt;] [&lt;colourway&gt;|panel=… needle=… glow=…] | rig fuel | rig name &lt;plate&gt;</span>');
}

// The counter. Cheap, heavy, and the thing everybody decides they do not need on the way out of the
// yard — which is the whole design of it. One box is one roadside attempt (`fix` spends it whether
// the repair takes or not), so carrying two is a real answer to a bad night and carrying six is a
// tonne of steel you are paying to accelerate for four hundred miles.
// ── THE PARTS COUNTER ────────────────────────────────────────────────────────
// Where a failed component comes from. Deliberately the same shelf as the spares box rather than a
// new surface: a yard is one counter, and a driver who knows to buy spares should not have to
// discover a second verb to buy an engine.
//
// ⚠ AN ENGINE IS NOT PUT IN YOUR POCKETS. It is craned onto the ground where you are standing, and
// that is the entire point of the carry rule (see PART_ITEMS): the heavy one is a fact about WHERE
// YOU ARE. Buying one at a yard four hundred miles from your dead truck is money spent on a crate
// sitting in the wrong town, which is a mistake the game should absolutely let you make.
const PART_PRICE = { engine: 2600, wheels: 780, body: 240 };
async function rigParts(player, what) {
  const part = PARTS.find((p) => p === String(what || '').toLowerCase());
  if (!part) {
    return say('<span class="text-dim">Parts on the shelf: '
      + PARTS.map((p) => `<b>${p}</b> ${PART_PRICE[p]}₵`).join(' · ')
      + '. <span class="text-dim">rig parts &lt;engine|wheels|body&gt;</span></span>');
  }
  const spec = PART_ITEMS[part], cost = PART_PRICE[part];
  if ((player.credits || 0) < cost) return say(`${cap(spec.label)} is <b>${cost}₵</b>. <span class="text-dim">You have ${player.credits || 0}₵.</span>`);
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const owner = spec.carry ? player.id : GROUND(player.current_zone);
  const { rows } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1', [owner, spec.item]);
  if (rows[0]) await query('UPDATE player_inventory SET quantity = quantity + 1 WHERE id=$1', [rows[0].id]);
  else await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
    [`inv_${randomUUID().slice(0, 12)}`, owner, spec.item]);
  return say(spec.carry
    ? `<span class="item-grant">${cap(spec.label)}, ${cost}₵. It goes in the cab and you'll feel it on every hill.</span>`
    : `<span class="item-grant">${cap(spec.label)}, ${cost}₵.</span>
<span class="text-dim">The yard crane swings it down onto the hardstand beside you. It stays where it lands — an engine isn't luggage.</span>`);
}

const SPARES_PRICE = 140;
async function rigSpares(player, nArg) {
  const n = Math.max(1, Math.min(6, parseInt(nArg, 10) || 1));
  const cost = SPARES_PRICE * n;
  if ((player.credits || 0) < cost) {
    return say(`A box of spares is <b>${SPARES_PRICE}₵</b>. <span class="text-dim">You have ${player.credits || 0}₵.</span>`);
  }
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  const have = await sparesInHand(player);
  if (have) await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id=$2', [n, have.id]);
  else {
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)',
      [`inv_${randomUUID().slice(0, 12)}`, player.id, SPARES_ITEM, n]
    );
  }
  return say(`<span class="item-grant">${n === 1 ? 'A box' : `${n} boxes`} of truck spares.</span>\n`
    + `<span class="text-dim">The man behind the counter doesn't ask where you're going. `
    + `One box is one go at it on the shoulder, and it's spent whether the repair takes or not.</span> `
    + `<span class="item-loss">-${cost}₵</span>`);
}

// TWO WAYS TO FIX A TRUCK, and the difference between them is certainty, not just price. A shop
// does it properly and charges for that. Your own hands are cheaper, botchable, and — the real
// constraint — cannot take a rig past Worked, because there is a limit to what gets done on a
// concrete floor with the toolbox that lives behind the seat.
// ── WHAT A FAILED COMPONENT NEEDS, AND WHERE IT HAS TO BE ────────────────────
// Credits buy labour. They do not buy a camshaft. Below `BROKEN_AT` a component has FAILED and the
// repair needs the real thing, which is a supply problem rather than a money one — and the shape of
// that problem is different for each part on purpose (see PART_ITEMS in damage.js): a wheel set and
// a stack of panels are freight you can carry, so being ready is something you did at the depot,
// while an engine is a crate on a pallet that has to already be in the room with you.
//
// Returns null when nothing is missing, or the refusal to print. The refusal always says WHAT and
// WHERE, because "you need a part" with no noun in it is the most annoying sentence a game can say.
const GROUND = (zoneId) => `_ground_${zoneId}`;   // mirrors inventory.js's own groundOwner — an item on the floor is a row owned by the room
async function partsMissing(player, dmg, parts) {
  const need = parts.filter((p) => isBroken(dmg[p]));
  if (!need.length) return null;
  for (const p of need) {
    const spec = PART_ITEMS[p];
    if (!spec) continue;
    const have = spec.carry
      ? await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity>0 LIMIT 1', [player.id, spec.item])
      // ⚠ THE GROUND IS AN INVENTORY, not a table of its own: an item lying in a room is a
      // `player_inventory` row owned by the zone's synthetic ground owner (see inventory.js
      // dropToGround). Anything looking for "is it in this room" has to ask the same way, or it
      // will be looking in a table that does not exist.
      : await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity>0 LIMIT 1', [GROUND(player.current_zone), spec.item]);
    if (have.rows.length) continue;
    return say(`<span class="text-amber">The ${PART_LABELS[p].label.toLowerCase()} hasn't worn out, it has FAILED.</span>
`
      + `<span class="text-dim">No hours and no money fix that — it needs ${spec.label}`
      + (spec.carry ? ", and you aren't carrying any. " : ", and there isn't one standing here. An engine goes where a forklift puts it. ")
      + `Yards sell them.</span>`);
  }
  return null;
}

// Which parts a repair CONSUMES, spent once the work is done rather than when it is offered — the
// opposite of the field `fix`, and deliberately so: a bench job with a fitter and a hoist is not a
// gamble on a shoulder in the rain, so the part goes in and stays in.
async function consumeParts(player, dmg, parts) {
  for (const p of parts) {
    if (!isBroken(dmg[p])) continue;
    const spec = PART_ITEMS[p];
    if (!spec) continue;
    if (spec.carry) {
      await query(`UPDATE player_inventory SET quantity = quantity - 1
                    WHERE player_id=$1 AND item_id=$2 AND quantity>0`, [player.id, spec.item]).catch(() => {});
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity<=0', [player.id, spec.item]).catch(() => {});
    } else {
      await query(`UPDATE player_inventory SET quantity = quantity - 1
                    WHERE player_id=$1 AND item_id=$2 AND quantity>0`, [GROUND(player.current_zone), spec.item]).catch(() => {});
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND quantity<=0', [GROUND(player.current_zone), spec.item]).catch(() => {});
    }
  }
}

// The bill for ONE component. Its own share of the whole-truck price (an engine is half the money
// in a truck and a panel is not), and a third of that again if the damage never got past a
// scratch — beating a dent out and respraying it is an afternoon, not a rebuild.
function partCost(type, dmg, part, pro) {
  const at = dmg[part];
  const whole = repairCost(type, at, pro);
  return Math.max(1, Math.ceil(whole * (PART_SHARE[part] ?? 1 / PARTS.length) * (isCosmetic(at) ? COSMETIC_MUL : 1)));
}

// ── `rig fit` / `rig unfit` — the cosmetic counter ───────────────────────────
// The catalogue and every rule about it live in fittings.js; this is the till, exactly as `rigKit`
// above is the till for the performance shelf and `rigPaint` is for the booth.
//
// ⚠ IT IS NOT `rig kit`, AND THE SPLIT IS DELIBERATE. A kit is five things that change how a truck
// DRIVES and a fitting is thirty-eight that change nothing at all, and collapsing them would mean a
// player scrolling past a bull bar to find the auxiliary tank — with no way to tell, from the list,
// which of the two is going to cost them a lap time. Two shelves, two verbs, and the boundary is
// "does this reach `effTruckParams`".
async function rigFit(player, truck, cd, arg) {
  const id = (arg || '').toLowerCase();
  if (!id) return fitCatalogue(truck, cd, null);
  if (id === 'all') return fitCatalogue(truck, cd, 'all');
  // ── A PLACE IS A LEGAL ARGUMENT, AND IT IS THE ONE PEOPLE TYPE ──────────────
  // `rig unfit roof` already worked, for the reason written on it: standing at the bench you know
  // where the thing is and not what it was called. Shopping is the same problem one step earlier —
  // you know you want something on the roof and not which four things a roof takes — and with the
  // catalogue now at thirty-eight rows, printing all of them to answer that is the wall this
  // change exists to stop printing.
  //
  // ⚠ A FITTING ID WINS OVER A SLOT NAME. Nothing in the catalogue currently collides, and this
  // ordering is what keeps that from mattering if one ever does: the specific thing you can buy
  // beats the general place it goes, so a new fitting can never silently turn into a listing.
  if (!FITTINGS[id]) {
    const asSlot = SLOTS.find((s) => s.id === id || s.label.toLowerCase() === id);
    if (asSlot) return fitCatalogue(truck, cd, asSlot.id);
  }
  const f = FITTINGS[id];
  if (!f) {
    // Named by its LABEL as well as its id, because "ram plate" is what is written on the panel
    // button and on the wall, and refusing the words the game itself used is a puzzle nobody asked
    // for. Exact match only — a fuzzy one would put a doll's head on somebody's bonnet.
    const byName = FIT_IDS.find((k) => FITTINGS[k].name.toLowerCase() === id);
    if (!byName) return say(`Nothing on the shelf by that name. <span class="text-dim">rig fit</span> lists it.`);
    return await rigFit(player, truck, cd, byName);
  }
  const slot = SLOTS.find((s) => s.id === f.slot);
  const already = fitInSlot(cd, f.slot);
  if (already === id) return say(`The ${f.name} is already on it.`);
  const cost = priceFor(cd, id);
  if ((player.credits || 0) < cost) return say(`The ${f.name} is ${cost}₵ and you have ${player.credits || 0}₵.`);

  // OWNED ONCE, WORN WHENEVER — see rule 5 in fittings.js. The purchase is recorded separately from
  // what is bolted on, so taking something off and putting it back is free forever. Without the
  // second list, "take it off and see" costs the full price to undo, and nobody would ever try
  // anything.
  const owned = Array.isArray(cd.owned_fits) ? cd.owned_fits.slice() : [];
  if (!owned.includes(id)) owned.push(id);
  cd.owned_fits = owned;
  cd.fits = [...installedFits(cd).filter((k) => FITTINGS[k].slot !== f.slot), id];
  await saveTruckData(truck.id, player.id, cd);
  if (cost) {
    player.credits -= cost;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  }
  // THE LIVE RIG TOO, for the same reason the wash zeroes it: the suffix is assembled from the bag,
  // the mounted rig is holding its own copy of that bag, and a fitting bought while somebody is
  // sitting in the truck must appear on the truck they are sitting in.
  const live = rigOf(player);
  if (live?.truckId === truck.id) live.cd = cd;
  await repush(player, 'bench');
  const swapped = already ? ` <span class="text-dim">The ${FITTINGS[already].name} comes off and goes in the drawer.</span>` : '';
  return say(`<span class="item-grant">Fitted: ${f.name}${cost ? ` — ${cost}₵` : ' — already yours, no charge'}.</span> `
    + `<span class="text-dim">${f.desc}</span>${swapped}`);
}

// Off, and it stays yours. Takes an id, a name, or the SLOT — `rig unfit roof` is what somebody
// standing at the bench actually means, and it is the only form that works when you cannot remember
// what the thing on the roof was called.
async function rigUnfit(player, truck, cd, arg) {
  const key = (arg || '').toLowerCase();
  const fitted = installedFits(cd);
  if (!fitted.length) return say("There's nothing bolted to it.");
  if (!key) return say(`Take what off? <span class="text-dim">${fitted.map((k) => `rig unfit ${k}`).join(' · ')}</span>`);
  const slot = SLOTS.find((s) => s.id === key);
  const id = slot ? fitInSlot(cd, slot.id)
    : (FITTINGS[key] ? key : FIT_IDS.find((k) => FITTINGS[k].name.toLowerCase() === key));
  if (!id || !fitted.includes(id)) return say("Nothing like that's on it.");
  cd.fits = fitted.filter((k) => k !== id);
  await saveTruckData(truck.id, player.id, cd);
  const live = rigOf(player);
  if (live?.truckId === truck.id) live.cd = cd;
  await repush(player, 'bench');
  return say(`<span class="item-grant">Off comes the ${FITTINGS[id].name}.</span> `
    + `<span class="text-dim">It goes in the drawer — putting it back on costs nothing.</span>`);
}

// ── THE SHELF, AS TYPABLE LINES ──────────────────────────────────────────────
// The log rung of the panel's cosmetic tab, and it was redesigned alongside it for the same reason
// and in the same shape: `rig fit` printed the WHOLE catalogue every time, and the commonest
// question — what has this truck got on it — was answerable only by reading every row and looking
// for the dots. At thirty-eight rows that is a wall, and a wall is not a list.
//
// So it is three answers rather than one, and the default is the short one:
//   `rig fit`          the SHEET. One line per place, what is in it, and how to open that shelf.
//   `rig fit roof`     one place's shelf, with the descriptions — which fit on screen.
//   `rig fit all`      the wall, deliberately still reachable, because somebody pricing up a whole
//                      rig wants it and a feature you can only browse a drawer at a time is worse.
//
// ⚠ THE SHEET AND THE PANEL'S SHEET ARE THE SAME EIGHT FACTS IN THE SAME ORDER, both derived from
// `SLOTS` + `installedFits`. That is the rule the panel states at the top of `fitsTab` — a shelf
// whose order differs between the panel and the log is two shelves — and it now covers the summary
// as well as the catalogue.
function fitCatalogue(truck, cd, only) {
  const fitted = new Set(installedFits(cd));
  const head = `<span class="text-amber">The cosmetic shelf — ${truck.type.name}</span>\n`
    + `<span class="text-dim">None of it does anything. One per place; swapping is free once it's yours.</span>`;
  const shelf = (sid) => SLOTS.filter((s) => !sid || s.id === sid).map((s) => {
    const items = FIT_IDS.filter((id) => FITTINGS[id].slot === s.id).map((id) => {
      const f = FITTINGS[id], on = fitted.has(id), price = priceFor(cd, id);
      const line = `  <b>${on ? '●' : '○'}</b> <b>${f.name}</b> <span class="text-dim">— ${price ? `${price}₵` : 'in the drawer'} · `
        + `${on ? `rig unfit ${id}` : `rig fit ${id}`}</span>`;
      // The description only in the one-place view. It is what tells you what the thing IS, and it
      // is the reason a single shelf is worth asking for — but thirty-eight of them is the wall.
      return sid ? `${line}\n     <span class="text-dim">${f.desc}</span>` : line;
    }).join('\n');
    return `<span class="text-amber">${s.label}</span> <span class="text-dim">${s.note}</span>\n${items}`;
  }).join('\n');
  if (only === 'all') return say(`${head}\n${shelf(null)}`);
  if (only) return say(`${head}\n${shelf(only)}`);
  const sheet = SLOTS.map((s) => {
    const id = [...fitted].find((k) => FITTINGS[k].slot === s.id);
    return `  <b>${id ? '●' : '○'}</b> <b>${s.label.padEnd(11)}</b> `
      + (id ? `<span class="text-green">${FITTINGS[id].name}</span>` : '<span class="text-dim">empty</span>')
      + `<span class="text-dim"> · rig fit ${s.id}</span>`;
  }).join('\n');
  const owned = FIT_IDS.filter((id) => !priceFor(cd, id) && !fitted.has(id)).length;
  return say(`${head}\n${sheet}\n`
    + `<span class="text-dim">A place at a time, or <b>rig fit all</b> for the whole shelf.`
    + `${owned ? ` ${owned} thing${owned === 1 ? '' : 's'} of yours ${owned === 1 ? 'is' : 'are'} in the drawer.` : ''}</span>`);
}

// ── `rig wash` — the hose ────────────────────────────────────────────────────
// ⚠ IT IS A `rig` SUBCOMMAND AND NOT THE VERB `wash`, and that is not a style choice — it is the
// same trap `rig strip` documents four hundred lines down. `wash` belongs to the mis plugin (it is
// how you get clean, and it is consent-gated), plugin verbs are first-come, and registering a truck
// one would have silently shadowed it for every player in the game the moment they stood at a sink.
// The bench is where the rest of the work on a truck already happens, so this is where it belongs
// anyway: the panel's button sends this exact string, and so can a driver.
//
// IT PUTS BACK NOTHING BUT THE COLOUR. No condition, no component, no part consumed, no skill check
// — there is no version of washing a truck you can be bad at, and a fabrication roll on a hose
// would be the system claiming a competence that is not in the fiction. What it costs is credits
// and what it buys is that you can see the paint you paid for.
async function rigWash(player, truck, cd) {
  const grime = grimeOf(cd);
  if (grime < 0.02) return say(`The ${truck.type.name} is already clean.`);
  const cost = washCost(grime);
  if ((player.credits || 0) < cost) return say(`The wash is ${cost}₵ and you have ${player.credits || 0}₵.`);
  const was = grimeBand(grime);
  cd.grime = 0;
  await saveTruckData(truck.id, player.id, cd);
  // AND THE TRUCK YOU ARE STANDING NEXT TO, IF IT IS ALSO THE TRUCK IN RAM. A rig can be mounted by
  // somebody else, or parked-but-live in this same yard, and the flush on its next park writes the
  // number it is holding — which would put every mile of dirt straight back on a truck the player
  // just paid to have cleaned. The row and the rig are the same truck and must agree.
  const live = rigOf(player);
  if (live?.truckId === truck.id) live.grime = 0;
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">Hot water and a long brush, and ${cost}₵ of somebody's afternoon. `
    + `The ${truck.type.name} comes out from under it — ${was.label.toLowerCase()}, and now not.</span>`);
}

async function rigRepair(player, truck, cd, mode, part) {
  const pro = /^(shop|pay|pro|full|bench)$/.test((mode || '').toLowerCase());
  // ONE COMPONENT, OR THE WHOLE TRUCK. `rig repair shop engine` fixes the engine and charges for
  // the engine; `rig repair shop` fixes everything, as it always has. The targeted form is the
  // whole reason the component model is worth having at a bench: a driver who has ruined the
  // wheels on gravel and left the engine alone should be able to pay for wheels, and the old
  // single bar could not express that bill. The default staying whole-truck matters just as much —
  // nobody should have to learn a parts vocabulary to keep a truck on the road.
  const dmg = damageOf({ cd, condition: truck.condition });
  const target = PARTS.includes((part || '').toLowerCase()) ? part.toLowerCase() : null;
  if (target) return await rigRepairPart(player, truck, cd, dmg, target, pro);
  const cond = truck.condition ?? 1;
  if (cond >= 0.995) return say(`The ${truck.type.name} is as good as it gets.`);
  if (!pro && cond >= FIELD_CAP) return say(`Nothing you can do to it with hand tools — it's already past what a field repair reaches. <span class="text-dim">rig repair shop</span>`);
  // THE WHOLE TRUCK, IF NOTHING ON IT HAS ACTUALLY FAILED. That is the rule the parts economy
  // hangs on: an ordinary tired rig is one bill and one visit, exactly as it always was, and it is
  // only a component that has GONE which turns the job into finding the thing itself.
  const blocked = await partsMissing(player, dmg, PARTS);
  if (blocked) return blocked;
  const cost = PARTS.reduce((n, p) => n + partCost(truck.type, dmg, p, pro), 0);
  if ((player.credits || 0) < cost) {
    return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
  }
  await consumeParts(player, dmg, PARTS);
  player.credits -= cost;
  let to, note = '';
  if (pro) {
    to = 1;
  } else {
    const chk = await skillCheck(player, 'fabrication', 5);
    // A botch does not waste the money — it gets you PART of the way, which is the honest outcome
    // of a job half-understood and keeps a low-skill player's repair worth doing.
    to = Math.min(FIELD_CAP, cond + (FIELD_CAP - cond) * (chk.success ? 1 : 0.55));
    await awardSkillUse(player.id, 'fabrication', chk.margin);
    if (!chk.success) note = ' <span class="text-amber">(Some of it beat you.)</span>';
  }
  // A WHOLE-TRUCK REPAIR LIFTS EVERY COMPONENT TO THE SAME PLACE, and then the headline number is
  // re-derived from them rather than written on its own. Writing `condition` directly here — which
  // is what this did before components existed — would have left the bag untouched underneath it,
  // so the next flush from a drive would recompute `overall` off the old parts and silently undo
  // the repair the player had just paid for.
  for (const p of PARTS) dmg[p] = Math.max(dmg[p], to);
  cd.dmg = dmg;
  await saveTruckData(truck.id, player.id, cd);
  await setCondition(truck.id, player.id, overall(dmg));
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  const band = bandOf(overall(dmg));
  return say(`<span class="item-grant">${pro ? "The depot's fitters take it in and give it back right" : 'You get under it yourself'} — ${cost}₵. `
    + `${truck.type.name}: <b>${band.label}</b> (${Math.round(overall(dmg) * 100)}%).</span>${note}`);
}

// One component. Priced off the SHARE of the truck a whole repair would have cost — a third of the
// tractor each — so three targeted repairs come to the same money as one whole one and there is no
// arbitrage either way. The field cap and the skill check are the same ones; there is deliberately
// no separate difficulty per part, because "wheels are easier than an engine" is a rule nobody
// could learn from the outside and it would only ever read as inconsistency.
async function rigRepairPart(player, truck, cd, dmg, part, pro) {
  const label = PART_LABELS[part].label;
  const at = dmg[part];
  if (at >= 0.995) return say(`The ${label.toLowerCase()} is as good as it gets.`);
  if (!pro && at >= FIELD_CAP) {
    return say(`Nothing you can do to the ${label.toLowerCase()} with hand tools. <span class="text-dim">rig repair shop ${part}</span>`);
  }
  const blocked = await partsMissing(player, dmg, [part]);
  if (blocked) return blocked;
  const cost = partCost(truck.type, dmg, part, pro);
  if ((player.credits || 0) < cost) return say(`That is ${cost}₵ of parts and labour and you have ${player.credits || 0}₵.`);
  await consumeParts(player, dmg, [part]);
  player.credits -= cost;
  let to, note = '';
  if (pro) to = 1;
  else {
    const chk = await skillCheck(player, 'fabrication', 5);
    to = Math.min(FIELD_CAP, at + (FIELD_CAP - at) * (chk.success ? 1 : 0.55));
    await awardSkillUse(player.id, 'fabrication', chk.margin);
    if (!chk.success) note = ' <span class="text-amber">(Some of it beat you.)</span>';
  }
  dmg[part] = Math.max(dmg[part], to);
  cd.dmg = dmg;
  await saveTruckData(truck.id, player.id, cd);
  await setCondition(truck.id, player.id, overall(dmg));
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">${pro ? 'The fitters have it out and back in' : 'You do the ' + label.toLowerCase() + ' yourself'} — ${cost}₵. `
    + `<b>${label}: ${partBand(to).label}</b> (${Math.round(to * 100)}%).</span>${note}\n`
    + `<span class="text-dim">Truck overall: ${bandOf(overall(dmg)).label}.</span>`);
}

// The dials. All four commit at once, exactly as flight's `tuneset` does, because they are read
// against each other — a gearing change you make without seeing what it did to the pull is a
// change you make twice.
async function rigTune(player, truck, cd, vals) {
  const fab = await effectiveSkill(player, 'fabrication');
  const range = tuneRange(fab, installedKits(cd));
  const keys = Object.keys(TUNE_PARAMS);
  const next = {};
  keys.forEach((k, i) => { next[k] = clampTune(vals[i], range) ?? 0; });
  cd.tune = next;
  if (!await saveTruckData(truck.id, player.id, cd)) return say("That truck won't take a setting.");
  await awardSkillUse(player.id, 'fabrication', 0);
  await repush(player, 'bench');
  const capped = keys.some(k => Math.abs(next[k]) >= range);
  return say(`<span class="item-grant">Dialled in: ${keys.map(k => `${TUNE_PARAMS[k].label} ${next[k] > 0 ? '+' : ''}${next[k]}`).join(', ')}.</span>`
    + (capped ? ' <span class="text-dim">That\'s as far as your hands and your gear will take it — a workshop instrument set would go further.</span>' : ''));
}

async function rigKit(player, truck, cd, kitId) {
  const kit = KITS[(kitId || '').toLowerCase()];
  if (!kit) return say(`No such kit. <span class="text-dim">${Object.keys(KITS).join(', ')}</span>`);
  const fitted = installedKits(cd);
  if (fitted.includes(kitId)) return say(`The ${kit.name} is already on it.`);
  if ((player.credits || 0) < kit.price) return say(`The ${kit.name} is ${kit.price}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= kit.price;
  cd.kits = [...fitted, kitId.toLowerCase()];
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await awardSkillUse(player.id, 'fabrication', 0);
  await repush(player, 'bench');
  return say(`<span class="item-grant">Fitted: ${kit.name}. ${kit.price}₵.</span> <span class="text-dim">${kit.desc}</span>`);
}

// A truck wears four colours, a paint job over them, a finish coat and a picture on the door — the
// name on the door is still the plate the fleet already stores, and a second copy of it here would
// be two answers to one question. The catalogue lives in rig.js; this is the till.
//
// ── THE GRAMMAR IS NAMED, AND IT HAD TO BECOME NAMED ─────────────────────────
// This was four positional arguments, which is fine for four and unusable for eight — nobody is
// going to remember that the seventh slot is the door art. `rigTrim` below already solved the same
// problem by making its arguments order-free, and its comment says why: a player should not have to
// remember which slot is which for a choice they make twice in a career.
//
// ⚠ BUT NOT THE SAME SOLUTION, because the trick `rig trim` uses does not work here. It infers a
// bare word's meaning from which catalogue it appears in, which is only safe while the catalogues
// are disjoint — and these are not: `candy` is a paint job AND a finish coat, `flames` is door art
// while `flame` is a paint job. So the keys are written down (`finish=candy`), and the OLD
// positional form is still accepted exactly as it was, because it is what every macro and every
// line of anyone's notes already says.
async function rigPaint(player, truck, cd, args) {
  const prev = cd.paint || {};
  const patch = {};
  const loose = [];
  for (const raw of args) {
    const tok = String(raw || '');
    const eq = tok.indexOf('=');
    if (eq > 0) { patch[tok.slice(0, eq).toLowerCase()] = tok.slice(eq + 1); continue; }
    loose.push(tok);
  }
  // `rig paint <id> preset <name>` — the whole scheme in one word. The panel's one-click swatches
  // are this verb, which is the rule the depot is built on: anything you can click you can type.
  if (loose[0] && loose[0].toLowerCase() === 'preset') {
    const p = presetPaint(loose[1], prev);
    if (!p) return say(`<span class="text-dim">Schemes: ${PAINT_PRESETS.map(r => r.id).join(', ')}.</span>`);
    Object.assign(patch, p);
    loose.length = 0;
  }
  // The legacy positional form, untouched: base, trim, flash, chrome.
  const [lb, lt, lf, lc] = loose;
  if (lb !== undefined && patch.base === undefined) patch.base = lb;
  if (lt !== undefined && patch.trim === undefined) patch.trim = lt;
  if (lf !== undefined && patch.flash === undefined) patch.flash = lf;
  if (lc !== undefined && patch.chrome === undefined) patch.chrome = lc;
  if (patch.chrome !== undefined) patch.chrome = patch.chrome !== '0' && patch.chrome !== 'off' && patch.chrome !== false;
  if (!args.length) {
    const list = (rows) => rows.map(r => r.id).join(', ');
    return say('<span class="text-dim">rig paint &lt;id&gt; base=#rrggbb trim=#rrggbb hw=#rrggbb deck=#rrggbb '
      + 'bright=#rrggbb glow=#rrggbb glass=#rrggbb '
      + 'flash=&lt;job&gt; finish=&lt;coat&gt; art=&lt;door&gt; chrome=0|1 — or <b>rig paint &lt;id&gt; preset &lt;name&gt;</b>.\n'
      + `Jobs: ${list(FLASHES)}.\nCoats: ${list(FINISHES)}.\nDoor: ${list(ARTS)}.\nSchemes: ${list(PAINT_PRESETS)}.</span>`);
  }
  const next = sanitizePaint(patch, prev);
  const cost = paintCost(truck.type, next);
  const changed = JSON.stringify(next) !== JSON.stringify(sanitizePaint({}, prev));
  if (!changed) { await repush(player, 'bench'); return { type: 'noop' }; }
  if ((player.credits || 0) < cost) return say(`A respray on something that size is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  cd.paint = next;
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  return say(`<span class="item-grant">Resprayed — ${cost}₵.</span> <span class="text-dim">${(FINISHES.find(f => f.id === next.finish) || {}).label || 'Gloss'}, and it comes out of the booth still smelling of it.</span>`);
}

// ── rig trim ─────────────────────────────────────────────────────────────────
// The inside of the respray. `rig trim` with no arguments is the catalogue; with one or two it is
// the job. Order-free on purpose — a material and a colourway cannot be confused for each other,
// so `rig trim walnut wood` and `rig trim wood walnut` are the same sentence and both work. The
// alternative is a positional grammar that makes a player remember which slot is which for a
// choice they make about twice in a career.
//
// ── AND ONE OF THE COLOURWAYS IS YOURS ───────────────────────────────────────
// `panel=#4a1f2e needle=#ffd489 glow=#c07a34` mixes one instead of picking one, and those three
// picks are all a colourway needs — see the ⚠ in client/shared/cab-trim.js for why it is three and
// not fourteen. NAMED arguments, where the swatches are bare words, for the reason `rig paint`'s
// are: a bare hex says nothing about which of the three it is, and three positional colours is a
// grammar nobody can hold. Naming any of them implies the custom colourway, so nobody has to say
// both, and an unnamed one falls back to the mix already stored — which is what makes "same again,
// but a green needle" one argument rather than three.
//
// ⚠ AND IT IS STILL ONE JOB AT ONE PRICE. Mixing is not a premium: the bench charges for the
// retrim, and what it costs to spray a dashboard does not depend on whether the colour came off a
// card. A surcharge here would be the panel charging for the absence of a limitation.
async function rigTrim(player, truck, cd, args) {
  const mats = Object.entries(DASH_MATERIALS), cols = Object.entries(DASH_COLOURWAYS);
  const now = sanitizeTrim(cd.trim || {}, {});
  const cost = trimCost(truck.type);
  const want = {};
  const mix = {};
  for (const a of args) {
    const k = String(a || '').toLowerCase();
    const kv = /^(panel|needle|glow)=(.+)$/.exec(k);
    if (kv) {
      if (!isTrimHex(kv[2])) return say(`<b>${kv[1]}</b> wants a colour like <span class="text-dim">#4a1f2e</span>, not <b>${kv[2].replace(/[<>]/g, '').slice(0, 16)}</b>.`);
      mix[kv[1]] = kv[2]; want.col = CUSTOM_COL;
    } else if (isDashMaterial(k)) want.mat = k;
    else if (isDashColourway(k)) want.col = k;
    else if (k === CUSTOM_COL) {   // refit a mix already stored — the way back after trying a swatch
      if (!now.cust) return say('You haven\'t mixed one yet. <span class="text-dim">rig trim panel=#4a1f2e needle=#ffd489 glow=#c07a34</span>');
      want.col = CUSTOM_COL;
    } else if (k) return say(`No such trim: <b>${k.replace(/[<>]/g, '')}</b>. Try <span class="text-dim">rig trim</span> on its own for the book.`);
  }
  if (want.col === CUSTOM_COL) {
    const c = sanitizeCustomTrim(mix, now.cust || {});
    if (!c) return say('A mixed interior needs all three: <span class="text-dim">panel</span>, <span class="text-dim">needle</span> and <span class="text-dim">glow</span>.');
    want.cust = c;
  }
  if (!args.length) {
    // The catalogue. It says what the truck is wearing NOW as well as what is on offer, because
    // "which of these am I looking at" is the first question anybody asks at a swatch book.
    const line = (k, label, blurb, on) =>
      `  <span class="action-link" data-action="cmd" data-cmd="rig trim ${k}">${on ? '<b>' : ''}${k}${on ? '</b>' : ''}</span>`
      + ` — ${label}${blurb ? `<span class="text-dim">, ${blurb}</span>` : ''}${on ? ' <span class="text-dim">(fitted)</span>' : ''}`;
    return say(`<b>Interior trim</b> <span class="text-dim">— ${cost}₵ a job, however much of it you change.</span>\n`
      + `<span class="text-dim">Material:</span>\n`
      + mats.map(([k, m]) => line(k, m.label, m.blurb, k === (now.mat || truckStockTrim(truck).mat))).join('\n')
      + `\n<span class="text-dim">Colourway:</span>\n`
      + cols.map(([k, c]) => line(k, c.label, '', k === (now.col || truckStockTrim(truck).col))).join('\n')
      + (now.cust ? '\n' + line(CUSTOM_COL, 'your own mix', `${now.cust.panel} panel, ${now.cust.needle} needle, ${now.cust.glow} glow`, now.col === CUSTOM_COL) : '')
      + `\n<span class="text-dim">Or mix one: </span><span class="action-link" data-action="cmd" data-cmd="rig trim panel=#4a1f2e needle=#ffd489 glow=#c07a34">panel, needle and glow, in hex</span>`
      + `\n<span class="text-dim">The bench doesn't sell instruments. What's in the binnacle came with the truck.</span>`);
  }
  const next = sanitizeTrim({ ...now, ...want }, now);
  if (JSON.stringify(next) === JSON.stringify(now)) { await repush(player, 'bench'); return { type: 'noop' }; }
  if ((player.credits || 0) < cost) return say(`Retrimming a cab is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  cd.trim = next;
  await saveTruckData(truck.id, player.id, cd);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'bench');
  const said = [next.mat && DASH_MATERIALS[next.mat]?.label,
    next.col === CUSTOM_COL ? 'your own mix' : next.col && DASH_COLOURWAYS[next.col]?.label].filter(Boolean).join(', ');
  return say(`<span class="item-grant">Retrimmed — ${cost}₵.</span> ${said}. It smells of glue and it'll for a week.`);
}
// What the truck LEFT THE FACTORY IN, for the catalogue's "fitted" marks. One mapping, in the
// shared file the renderer reads — a second copy here would drift the first time a stock interior
// was recoloured, and the symptom would be the swatch book ticking the wrong row.
const truckStockTrim = (truck) => stockTrim(truck?.type?.tier ?? 1);
// A stored trim with its nulls DROPPED, so it can be spread over the stock row without a null
// wiping the factory answer back out. `sanitizeTrim` deliberately returns null for a key nobody
// has bought — that is right for storage and wrong for a merge.
const sanitizeTrimResolved = (raw) => {
  const t = sanitizeTrim(raw || {}, {});
  const out = {};
  if (t.mat) out.mat = t.mat;
  if (t.col) out.col = t.col;
  // The three picks travel with it whether or not the mix is the one FITTED — the panel needs them
  // to fill its wells with what this driver last chose rather than with a default nobody picked.
  if (t.cust) out.cust = t.cust;
  return out;
};

// Filling a PARKED truck. `fuel` (the older verb) fills the one you are sitting in, out on the
// road; this is the same act at a depot with the keys in your pocket, and it is the button the
// panel shows next to the gauge.
async function rigFuel(player, truck, bay, depot) {
  const yard = getZone(yardIdOf(bay, depot));
  const pump = pumpAt({ leg: 'city', zoneId: yard?.id }) || pumpAt({ leg: 'city', zoneId: bay?.id });
  if (!pump) return say('This yard keeps no diesel. You would have to run it to a pump.');
  const need = 1 - (truck.fuel ?? 1);
  if (need < 0.02) return say("It's already full.");
  const cost = Math.round(need * FUEL_FULL);
  if ((player.credits || 0) < cost) return say(`Filling it is ${cost}₵ and you have ${player.credits || 0}₵.`);
  player.credits -= cost;
  await setFuel(truck.id, player.id, 1);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Tanks filled. ${cost}₵.</span>`);
}

async function rigName(player, truck, plate) {
  const clean = String(plate || '').replace(/[<>]/g, '').trim().slice(0, 28);
  if (!clean) return say('Call it what?');
  await query('UPDATE trucks SET name=$1 WHERE id=$2 AND owner_id=$3', [clean, truck.id, player.id]).catch(() => {});
  await repush(player, 'fleet');
  return say(`<span class="item-grant">Signwritten: <b>${clean}</b>.</span>`);
}

// ── `rig strip` — the road as a supply line ──────────────────────────────────
// ⚠ IT IS A `rig` SUBCOMMAND, NOT A VERB, and that is not a style choice: `strip` belongs to the
// mis plugin (taking your clothes off), plugin verbs are first-come, and registering a second one
// would have silently shadowed a consent-gated verb with a truck command. The regress caught it.
// Every other bench-and-counter job is already `rig <something>`, so this is where it belonged.
// A dead truck by the roadside is somebody's whole evening, and until now it was scenery with a
// name on it. Stripping one is the second way parts enter the world (the yard counter is the
// first, fabrication the third), and it is the only one that costs no credits at all — what it
// costs is that you are standing outside your cab, in the waste, at a hulk, which is precisely
// where the things that live out here would like you to be.
//
// TWO RULES, and both fall out of what a wreck IS rather than from balance:
//
//  1. YOU CANNOT TAKE AN ENGINE OFF ONE. Not because a wreck has no engine — it obviously does —
//     but because an engine cannot be carried and the corridor is a transient room that ceases to
//     exist when the crossing ends. A crated engine dropped out here is freight you have thrown
//     away, which is the same rule that stops you dropping a TRAILER in the void (trailers.js rule
//     2). The road gives you the parts a person can lift and nothing else, and that keeps the
//     worst failure in the game a problem about towns.
//
//  2. A HULK IS STRIPPED ONCE. It is marked on the wreck itself, which is shared world state, so
//     the second driver past finds it picked over — the same wreck, the same place, the same
//     history, and nothing left on it. A per-player flag would have let ten drivers each take a
//     full set of wheels off one truck.
const STRIP_YIELD = [
  { item: 'item_wheel_set', label: 'a set of lifter housings off the drive bogie', diff: 9 },
  { item: 'item_body_panel', label: 'enough sound panel to patch a cab', diff: 4 },
  { item: 'item_scrap_metal', label: 'an armful of scrap', diff: 0, qty: 3 },
];
async function rigStrip(player) {
  const rig = rigOf(player);
  if (!rig) return say('You would need to be out here in a truck.');
  if (Math.abs(rig.speed) > HITCH_MPH) return say('Not at this speed. Stop alongside it first.');
  if (rig.leg !== 'corridor' || !rig.route) return say('Nothing out here to strip. Wrecks are a road thing.');
  const w = wreckNear(rig.route, rig.s);
  if (!w) return say('There\'s nothing beside you but ground. <span class="text-dim">The radio tells you about wrecks before you reach them.</span>');
  if (w.stripped) {
    return say('<span class="text-dim">Somebody has been through it already. The housings are gone, the panels are gone, and what\'s left is the shape of a truck with nothing in it.</span>');
  }
  const chk = await skillCheck(player, 'fabrication', 6);
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  // WHAT COMES OFF IT is decided by how well you know what you are looking at. A good hand takes
  // the housings; a bad one takes panel and scrap and tells themselves it was worth stopping.
  const fab = await effectiveSkill(player, 'fabrication');
  const got = STRIP_YIELD.find((y) => fab >= y.diff && (y.diff === 0 || chk.success)) || STRIP_YIELD[STRIP_YIELD.length - 1];
  w.stripped = true;
  const qty = got.qty || 1;
  const { rows } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1', [player.id, got.item]);
  if (rows[0]) await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id=$2', [qty, rows[0].id]);
  else await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)',
    [`inv_${randomUUID().slice(0, 12)}`, player.id, got.item, qty]);
  return say(`<span class="item-grant">You get the cover off and take ${got.label}.</span>
`
    + `<span class="text-dim">${w.who ? `Whatever happened to ${w.who} out here, it isn't going to happen to their gearbox as well.` : 'Nobody is coming back for the rest of it.'}</span>`);
}

// Resolved by ITEM ID rather than by name or tag. A tag would be the house preference, but a tag
// exists to let CONTENT decide which things behave a certain way, and there is exactly one thing
// here: a box of spares for a truck. Inventing a vocabulary entry for a set of size one is how tag
// catalogues get to two hundred entries nobody can remember.
async function sparesInHand(player) {
  const { rows } = await query(
    `SELECT id, quantity FROM player_inventory
      WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND quantity > 0 LIMIT 1`,
    [player.id, SPARES_ITEM]
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}
async function spendSpares(row) {
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
}
// ── Out of this file ─────────────────────────────────────────────────────────
// `cmdRig` is the verb. The other two are the spares box, which the ROADSIDE also spends:
// `fix` in index.js burns one whether the repair takes or not, and the counter that sells them is
// here, so this is where the reading and the spending of them live.
// The two trim helpers go out as well, because the depot PANEL renders a cab's trim on the fleet tab
// and the rules for what a trim is are the bench's. ⚠ They are used there as `{ ...truckStockTrim(t) }`
// — spread — which is exactly the shape a naive cross-boundary scan misses, and did.
export { cmdRig, sparesInHand, spendSpares, truckStockTrim, sanitizeTrimResolved };
