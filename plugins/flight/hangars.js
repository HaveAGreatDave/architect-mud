// Flight — ownership layer: hangars (secure storage), maintenance (repair), the
// wreck-salvage loop (strip a downed craft; rebuild a Carcass into a flyable), and
// deep tuning (the continuous mixture/pitch/boost/CG curves that feed the tick-loop
// hazard math + the HUD via state.effStats). Parts-as-items are a lighter follow-on;
// the tuning curves are the meat of "make it yours."

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { liveAircraft, persist, out, effStats, fieldFor as fieldOf,
  SEAT_KG, isConfigurable, loadoutBudget, effLoadout, sendToPlayer, skyState, inHangarInterior,
  FLIGHT_PACE, tuneRange, installedKits, KITS, perfAxes, parkAt, nearestAirfield, craftIsVtol, getZone,
  PARTS, PART_SLOTS, slotsFor, installedParts, partDefs, partEnvelope,
  detach, getLivePlayer, resetSurfaces, acquirableTypes, airfieldOf, fieldName } from './state.js';
import { normalizeLivery, sanitizeLivery, signatureScore, describeExterior,
  paintCost, isPaintable, readSchemes, schemeOf,
  PATTERNS, FINISHES, UPHOLSTERY, DECALS, PRESETS } from './livery.js';
import { fieldStocks } from './acquisition.js';
import { pilotStatusForField, charterParkedAt } from './charter.js';
import { isPilotLicensed } from './checkride.js';
import { prefersTextMinigamesOrDefault } from '../../server/engine/presentation.js';
import { emit } from '../../server/engine/events.js';
// `tune` also belongs to broadcast (tune a channel); flight wins it and hands
// back when you're not tuning an aircraft. `repair` shadows the engine gear-repair
// builtin — cmdRepair returns undefined out of aircraft context to fall through.
import { commands as broadcastCommands } from '../broadcast/index.js';
// `sell` belongs to commerce (selling inventory items); flight wins it by load
// order and delegates back unless the leading token is a real aircraft id.
import { commands as commerceCommands } from '../commerce/index.js';

const nowSec = () => Math.floor(Date.now() / 1000);

// The direction the "Exit Hangar" button walks the player out of a walk-in hangar
// interior. Interiors were originally seeded with an `out` exit, but the district
// rebuild re-wired them to a lateral compass door (e.g. `east`) and dropped `out`,
// so a hardcoded `out` no longer resolves. Prefer `out` when it still exists, else
// the first lateral door (not the up/down utility shaft) — that's the way to the ramp.
function hangarExitDir(player) {
  const z = getZone(player.current_zone);
  if (!z?.flags?.hangar_interior || !z.exits) return 'out';
  if (z.exits.out) return 'out';
  return Object.keys(z.exits).find(d => !['up', 'down', 'in'].includes(d)) || 'out';
}

// The hangar-bay panel always knows exactly which craft is selected — its action
// buttons put that craft's real id as the FIRST token of the command they send
// (`repair <id>`, `modify <id> mixture 1`, …). Typed commands never do (a player
// never types a UUID), so this is invisible outside the panel: pop it off the
// front when present, leaving the rest of args exactly as a typed command would
// have produced them.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A leading arg is a craft id if it's a UUID OR the `aircraft_<kind>_<owner>_<rand>`
// form the fleet actually mints (see acquisition/charter/test). WITHOUT the second case
// the explicit id the hangar panel passes (`installkit <id> <kit>`) fails the match, is
// dropped, and the command falls back to a zone lookup that misses inside a hangar.
const isCraftId = (s) => UUID_RE.test(s) || /^aircraft_[a-z0-9_]+$/i.test(s);
function popCraftId(args) {
  return isCraftId(args[0] || '') ? { id: args[0], rest: args.slice(1) } : { id: undefined, rest: args };
}

// The aircraft the player is aboard, or (given an explicit id) that exact craft —
// otherwise their single parked craft here.
async function targetCraft(player, id) {
  if (id) {
    const { rows } = await query('SELECT id FROM aircraft WHERE id=$1 AND owner_id=$2 AND is_wreck=0', [id, player.id]);
    return rows[0] ? { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null } : null;
  }
  if (player.aircraftId) { const l = liveAircraft.get(player.aircraftId); if (l) return { id: l.row.id, live: l }; }
  // Parked craft live at the FIELD/ramp zone; inside a hangar interior player.current_zone
  // is the interior, so resolve to the field zone the same way buildCards does.
  const zoneId = fieldOf(player)?.id || player.current_zone;
  const { rows } = await query('SELECT id FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 LIMIT 1', [zoneId, player.id]);
  return rows[0] ? { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null } : null;
}

// Customisation is OWNER-ONLY: the craft the player is aboard or parked here that
// they actually own outright (not a charter rental). { notOwned:true } means
// they're near/aboard something that isn't theirs to modify.
async function ownedCraft(player, id) {
  if (id) {
    const { rows } = await query('SELECT id, owner_id, rental FROM aircraft WHERE id=$1 AND is_wreck=0', [id]);
    const ac = rows[0];
    if (!ac) return null;
    return (ac.owner_id === player.id && !ac.rental) ? { id: ac.id, live: liveAircraft.get(ac.id) || null } : { notOwned: true };
  }
  if (player.aircraftId) {
    const l = liveAircraft.get(player.aircraftId);
    if (l) return (l.row.owner_id === player.id && !l.row.rental) ? { id: l.row.id, live: l } : { notOwned: true };
  }
  const zoneId = fieldOf(player)?.id || player.current_zone;
  const { rows } = await query('SELECT id FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND rental=0 AND is_wreck=0 LIMIT 1', [zoneId, player.id]);
  return rows[0] ? { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null } : null;
}
async function loadCd(tgt) {
  if (tgt.live) return tgt.live.row.custom_data || {};
  const { rows } = await query('SELECT custom_data FROM aircraft WHERE id=$1', [tgt.id]);
  return rows[0]?.custom_data || {};
}
async function saveCd(tgt, cd) {
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), tgt.id]);
  if (tgt.live) tgt.live.row.custom_data = cd;
}
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim();

// ── The unified 3D hangar-bay (client renders; server owns the data) ──────────
// One card per aircraft of the player's parked at this field (owned on the ramp,
// stored in a bay, or a rental), plus any wreck sitting here. Livery, tune curves,
// and the loadout/repair numbers all ride along so a single push can drive the
// floor (turntables side-by-side), the paint bay, and the mechanics-bench readouts
// without a round trip per screen.
async function buildCards(player, field) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.rental, a.is_wreck, a.hangar_id, a.damage, a.fuel, a.custom_data,
            a.owner_id, t.data tdata, t.id type_id, t.name tname, t.class, t.fuel_capacity, t.fuel_type, t.seats, t.hardpoints,
            t.hull_hp, t.cargo_capacity, t.cruise_speed, t.fuel_burn_base, t.max_takeoff_weight,
            t.handling, t.altitude_ceiling
     FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id
     WHERE a.parked_zone_id=$1 AND ((a.owner_id=$2 AND a.is_wreck=0) OR a.is_wreck=1)
     ORDER BY a.is_wreck, a.rental, t.price_buy`,
    [field.id, player.id]);
  // Range widens with the pilot's own Fabrication (same for every card) + per-craft kits.
  const fab = await effectiveSkill(player, 'fabrication');
  return rows.map(r => {
    const lv = normalizeLivery(r.custom_data), cap = r.fuel_capacity || 1;
    const schemes = Object.entries(readSchemes(r.custom_data)).map(([name, s]) => ({ name, base: s.base, trim: s.trim }));
    const cd = r.custom_data || {};
    // Full template numbers the performance model reads (state.computeStats/perfAxes).
    const type = { class: r.class, seats: r.seats, cargo_capacity: r.cargo_capacity,
      cruise_speed: r.cruise_speed, fuel_burn_base: r.fuel_burn_base, max_takeoff_weight: r.max_takeoff_weight || 300,
      handling: r.handling, altitude_ceiling: r.altitude_ceiling, fuel_capacity: cap, hardpoints: r.hardpoints || 0 };
    const configurable = isConfigurable(type);
    const budget = configurable ? loadoutBudget(type) : 0;
    const cur = configurable ? effLoadout({ custom_data: cd }, type) : null;
    const tune = { mixture: 0, pitch: 0, boost: 0, cg: 0, ...(cd.tune || {}) };
    const kits = installedKits(cd), cargoNow = cd.cargoWeight || 0;
    // Fitted parts move the envelope, so every number on this card has to see them —
    // the fuel gauge included: a ferry tank means 100% is a bigger 100%.
    const parts = partDefs(cd), partCap = cap * partEnvelope(parts).fuelCapMult;
    return {
      id: r.id, tail: r.name || r.tname, typeName: r.tname, typeId: r.type_id, class: r.class, seats: r.seats,
      hardpoints: Math.max(r.hardpoints || 0, partEnvelope(parts).hardpoints),   // >0 on a heli ⇒ the client draws the Viper attack mesh, not the Dragonfly

      damage: r.damage, hullPct: Math.max(0, Math.round((1 - r.damage) * 100)),
      fuelPct: Math.max(0, Math.min(100, Math.round((r.fuel / partCap) * 100))), fuelType: r.fuel_type,
      location: r.is_wreck ? 'wreck' : (r.hangar_id ? 'hangar' : 'ramp'),
      rental: !!r.rental, wreck: !!r.is_wreck, paintable: isPaintable(r),
      livery: lv, schemes, signature: signatureScore(lv), paintCost: paintCost({ class: r.class }),
      // Repair (mechanics bench): what a DIY vs. shop fix would cost right now.
      diyCost: r.rental ? 0 : Math.ceil(r.damage * r.hull_hp * 6),
      shopCost: r.rental ? 0 : Math.ceil(r.damage * r.hull_hp * 15),
      // Tuning: continuous knob values, the reachable ± the dials clamp to, the base
      // numbers the client mirrors for live-drag preview, and the authoritative
      // performance snapshot the graph shows for the committed tune.
      tune, tuneRange: tuneRange(fab, kits, parts),
      perfBase: { cruise: r.cruise_speed, burn: r.fuel_burn_base, maxTOW: r.max_takeoff_weight || 300, pace: FLIGHT_PACE },
      cargoNow, kitsInstalled: kits,
      kitCatalog: Object.entries(KITS).map(([id, k]) => ({ id, name: k.name, price: k.price, blurb: k.blurb, owned: kits.includes(id) })),
      perfNow: perfAxes(type, tune, cargoNow, kits, parts),
      // The discrete layer, for a bench that wants to draw it: which slots this airframe
      // has, what is in them, and the mass that hardware is already costing her.
      partSlots: slotsFor(type).map(sl => ({ id: sl.id, label: sl.label, fitted: installedParts(cd)[sl.id] || null })),
      partsFitted: installedParts(cd), partKg: partEnvelope(parts).kg,
      // Cabin loadout (weight & balance) — only meaningful on configurable haulers.
      configurable, loadoutBudget: budget, maxSeats: configurable ? Math.max(1, Math.floor(budget / SEAT_KG)) : r.seats,
      seatsNow: cur?.seats ?? r.seats, cargoCapNow: cur?.cargoCap ?? 0, cargoLoaded: cd.cargoWeight || 0,
      // Ag-plane chemical hopper (the Locust). cap 0 on everything else, which is the whole
      // gate — the bench grows a HOPPER tab only for an aircraft that actually has one.
      hopperCap: (r.tdata && r.tdata.spray && r.tdata.hopper) || 0,
      hopperAmount: Math.round(cd.hopper?.amount || 0), hopperFluid: cd.hopper?.fluid_type || null,
    };
  });
}

// Everything in the player's hands holding liquid — the pour list for the Hopper tab. The
// SAME predicate cmdLoadHopper matches on (a fillable container with fluid_amount > 0), because
// a button offering a can the verb would then refuse is worse than no button.
async function carriedFluids(player) {
  const { rows } = await query(
    `SELECT i.name, COALESCE(pi.custom_data->>'fluid_type','water') fluid,
            SUM(COALESCE((pi.custom_data->>'fluid_amount')::numeric,0)) amount, COUNT(*) n
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'fillable')
        AND COALESCE((pi.custom_data->>'fluid_amount')::numeric,0) > 0
      GROUP BY i.name, fluid ORDER BY amount DESC LIMIT 12`, [player.id]);
  // Grouped by name+fluid, because the verb takes a NAME and pours one container per call —
  // three identical jerry cans are one button you press three times, not three buttons.
  return rows.map(r => ({ name: r.name, fluid: r.fluid, amount: Math.round(Number(r.amount)), count: Number(r.n) }));
}

// ── The text hangar (the same floor, written down) ────────────────────────────
// The game-wide Display Mode (server/engine/presentation.js, read here through
// textmode.js) covers the whole of flight, not just the ride: a player who asked never to be shown the
// graphical cockpit must never have the 3D hangar bay thrown at them either — least
// of all by walking through a door, which is how the bay auto-opens. So the gate
// lives in pushHangarBay rather than in `cmdHangar`, and every entry point (bare
// `hangar`, `fleet`, `showroom`, `view <tail>`, the zone.entered auto-open, and the
// post-action refreshes each command fires) is covered by construction.
//
// It SENDS rather than returning, because half the callers do
// `await pushHangarBay(player); return { type:'emote', … }` — a returned message
// there would be dropped on the floor. Sending and returning `noop` keeps one shape
// for both kinds of caller and can never double-print.
const link = (cmd, label) => `<span class="action-link" data-action="cmd" data-cmd="${cmd}">${label || cmd}</span>`;

function textCraftLine(c, detailed) {
  const where = c.wreck ? 'wreck' : (c.location === 'hangar' ? 'in the bay' : 'on the ramp');
  const tags = [c.typeName, where];
  if (c.rental) tags.push('rental');
  let s = `· <b>${clean(c.tail)}</b> <span class="text-dim">(${tags.join(', ')})</span>`
    + ` — hull ${c.hullPct}%, fuel ${c.fuelPct}% <span class="text-dim">(${c.fuelType})</span>`;
  // `salvage`/`rebuild` work off the wreck standing in this zone and take no
  // argument — don't hand them a craft id they'd try to parse.
  if (c.wreck) return `${s}\n   ${link('salvage', 'salvage')} · ${link('rebuild', 'rebuild')}`;
  const acts = [link(`embark ${c.tail}`, 'embark')];
  if (c.fuelPct < 100) acts.push(link(`refuel ${c.id}`, 'refuel'));
  // A hopper is a second tank and reads as one: the same rung, the same shape of link.
  if (c.hopperCap > 0) acts.push(`${link(`loadhopper ${c.id}`, 'load hopper')} <span class="text-dim">(${Math.round(c.hopperAmount / c.hopperCap * 100)}%${c.hopperFluid ? `, ${c.hopperFluid}` : ''})</span>`);
  if (c.hullPct < 100 && !c.rental) acts.push(`${link(`repair ${c.id}`, 'repair')} <span class="text-dim">(${c.diyCost}₵ DIY · ${c.shopCost}₵ shop)</span>`);
  if (!c.rental) {
    // The full sheet — tuning curves, name/livery. `modify <id>` is the one that
    // takes an explicit craft id; bare `tune` would grab whichever craft is first.
    acts.push(link(`modify ${c.id}`, 'modify'));
    if (c.configurable) acts.push(link(`loadout ${c.id}`, 'loadout'));
  }
  s += `\n   ${acts.join(' · ')}`;
  if (detailed) {
    const t = c.tune;
    s += `\n   <span class="text-dim">Tune — mixture ${t.mixture} · pitch ${t.pitch} · boost ${t.boost} · CG ${t.cg}`
      + ` | seats ${c.seatsNow}, cargo ${c.cargoLoaded}/${c.cargoCapNow}kg`
      + ` | kits: ${c.kitsInstalled.length ? c.kitsInstalled.map(k => KITS[k]?.name || k).join(', ') : 'none'}</span>`;
  }
  return s;
}

async function textHangarBay(player, field, selectId, opts) {
  // A background refresh has nothing to say in text — the player didn't ask to be
  // shown the floor, and reprinting it after every action would be a wall of scroll.
  if (opts.refreshOnly) return { type: 'noop' };
  const { rows: mine } = await query('SELECT id, name FROM hangars WHERE field_zone=$1 AND owner_id=$2', [field.id, player.id]);
  const craft = await buildCards(player, field);
  const name = fieldName(field);
  let msg = `<span class="text-cyan">HANGAR — ${name}</span>`
    + ` <span class="text-dim">(text display mode; Tablet → Settings → Display Mode to change)</span>`;
  msg += `\n<span class="furniture-label">Your bay:</span> `
    + (mine.length ? `${clean(mine[0].name)} — ${link('hangar store', 'store')} · ${link('hangar pull', 'pull')}`
      : `<span class="text-dim">you rent none here</span> — ${link('hangar rent', 'hangar rent')} <span class="text-dim">(200₵/period, safe from thieves)</span>`);

  if (craft.length) {
    const sel = selectId ? craft.filter(c => c.id === selectId) : [];
    const rest = sel.length ? craft.filter(c => c.id !== selectId) : craft;
    msg += `\n<span class="furniture-label">On the floor:</span>`;
    for (const c of sel) msg += `\n${textCraftLine(c, true)}`;
    for (const c of rest) msg += `\n${textCraftLine(c, false)}`;
  } else {
    msg += `\n<span class="text-dim">Nothing of yours is here.</span>`;
  }

  const af = airfieldOf(field);
  const canBuy = !!af?.dealer, canRent = !!af?.rental;
  if (canBuy || canRent) {
    const types = await acquirableTypes(field);
    if (types.length) {
      msg += `\n<span class="furniture-label">For ${canBuy && canRent ? 'sale or hire' : (canBuy ? 'sale' : 'hire')}:</span>`;
      for (const t of types) {
        const bits = [];
        if (canBuy) bits.push(`${link(`buy ${t.id}`, 'buy')} ${t.price_buy}₵`);
        if (canRent) bits.push(`${link(`rent ${t.id}`, 'rent')} ${t.price_rent_hourly}₵/hr`);
        msg += `\n· <b>${t.name}</b> <span class="text-dim">(${t.class}, ${t.seats} seat${t.seats > 1 ? 's' : ''}, ${t.fuel_type})</span> — ${bits.join(' · ')}`;
      }
      if (!await isPilotLicensed(player) && !['admin', 'dev'].includes(player.role))
        msg += `\n<span class="text-amber">You're not rated to fly — see the examiner for a checkride before you buy.</span>`;
    }
  }

  const parked = charterParkedAt(field.id);
  if (parked && parked.chartererId === player.id)
    msg += `\n<span class="furniture-label">Charter waiting:</span> bound for ${parked.destName} — ${link('embark', 'embark')}`;
  else if (pilotStatusForField(field.id).present)
    msg += `\n<span class="furniture-label">Charter desk:</span> ${link('charter', 'charter')} <span class="text-dim">— ${pilotStatusForField(field.id).name} is on shift</span>`;

  const stocks = fieldStocks(field);
  if (stocks.length) msg += `\n<span class="text-dim">Pumps here: ${stocks.join(', ')} — ${link('refuel', 'refuel')}</span>`;
  msg += `\n<span class="text-dim">Credits: ${player.credits || 0}₵</span>`;

  sendToPlayer(player.id, { type: 'output', message: msg });
  return { type: 'noop' };
}

// `opts.refreshOnly` marks this push as a background refresh (e.g. after a remote
// tablet sale): the client updates the hangar bay only if it's already open on
// screen, and ignores it otherwise instead of popping the 3D hangar open.
export async function pushHangarBay(player, selectId, opts = {}) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Hangars are at the airfields.' };
  // THE MIDDLE RUNG TAKES THE BAY TOO. This used to read `prefersTextTravel` (the
  // bottom rung only), on the reasoning that a hangar is a readout you could always
  // type your way around. In the hand that was wrong: the bay is a full-screen 3D app
  // with its own WASD walk-around camera that AUTO-OPENS when you walk through a door,
  // and a player who asked for flight in text got it thrown over their room anyway.
  // The classification question ("delete it — are they stuck?") is the right one; the
  // honest answer for THIS surface is that it takes the screen and the keyboard, which
  // is what `textgames` exists to decline. The passenger cabin window is untouched and
  // still bottom-rung — see textmode.js.
  if (await prefersTextMinigamesOrDefault(player)) return textHangarBay(player, field, selectId, opts);
  // WHERE THEY WERE WHEN THEY ASKED. Everything below is awaited DB work — five
  // round trips against a remote Postgres — and the auto-open path fires from
  // `zone.entered`, so a player who walks straight back out is long gone by the
  // time the panel is built. The push would then open a full-screen hangar over
  // whatever room they're actually standing in: step onto the Solenne Sky Pad,
  // turn round into the lift, and the Sky Pad bay would bloom over the elevator
  // car until the next look. Checked again at the send, below.
  const askedFrom = player.current_zone;
  const { rows: mine } = await query('SELECT id FROM hangars WHERE field_zone=$1 AND owner_id=$2', [field.id, player.id]);
  const craft = await buildCards(player, field);
  // A charter this player already booked shows as a fuelled, boarding-ready CHARTER
  // Mule on the floor (not "off shift") — the pilot's busy precisely because it's
  // held for them; clicking it embarks instead of opening the booking dialog.
  const parked = charterParkedAt(field.id);
  const charterWaiting = parked && parked.chartererId === player.id ? { destName: parked.destName } : null;
  // Three independent desks on the airfield row: `dealer` sells, `rental` rents
  // self-flown airframes, `charter` books an NPC-piloted ride. A field can
  // have any combination — the Echelon pad and Buzzard Field both charter without
  // renting. (Rental used to be implied by `charter`, which made a
  // charter desk impossible to open without also opening a rental counter.)
  const af = airfieldOf(field);
  const canBuy = !!af?.dealer, canRent = !!af?.rental;
  // ONE lot per airframe carrying BOTH prices — the client shows a single wireframe with a
  // Buy and a Rent button under it (each gated on afford + licence), instead of separate
  // buy/rent sections. Buy/Rent buttons still show only where the field offers that desk.
  let lots = [];
  if (canBuy || canRent) {
    // Shared roster with the text desk — a helipad has no runway, so it offers
    // VTOL only. This lot used to run its own unfiltered query, which showed
    // fixed-wings whose Buy/Rent buttons the server then refused.
    const types = await acquirableTypes(field);
    // `hardpoints` rides along because CLASS ALONE DOESN'T NAME THE MESH: an armed heli draws the
    // Viper (stub wings, rocket pods, chin gun), an unarmed one the Dragonfly, and without this the
    // whole lot fell back to the Dragonfly — you shopped for a gunship and were shown a taxi.
    lots = types.map(t => ({ id: t.id, name: t.name, class: t.class, seats: t.seats, fuel: t.fuel_type,
      hardpoints: t.hardpoints || 0, priceBuy: t.price_buy, priceRent: t.price_rent_hourly }));
  }
  // What's in your hands to pour, for the bench's Hopper tab. GATED on somebody on the floor
  // actually having a hopper — this is a sixth round trip on a panel that already makes five,
  // and for the whole fleet bar the Locust the answer can never be used.
  const chemCans = craft.some(c => c.hopperCap > 0) ? await carriedFluids(player) : [];
  // Licence gate for the acquisition buttons (admins/devs are auto-rated + bypass the price).
  const licensed = await isPilotLicensed(player);
  const isAdmin = ['admin', 'dev'].includes(player.role);
  // They moved while we were building it — drop the push rather than opening a
  // hangar over a room that isn't one. `noop` because every caller here is a
  // command handler and null would read as an unhandled verb.
  if (player.current_zone !== askedFrom) return { type: 'noop' };
  sendToPlayer(player.id, { type: 'hangar_bay_open', data: {
    field: fieldName(field),
    // Tells the client whether "Close" also has to walk the player back out to
    // the ramp (standing inside the walk-in hangar) or just dismisses the panel
    // (opened from the open ramp itself, where there's no interior to leave).
    inHangar: inHangarInterior(player),
    exitDir: hangarExitDir(player),
    refreshOnly: !!opts.refreshOnly,
    hasBay: mine.length > 0, credits: player.credits || 0, craft, chemCans,
    // Fuel types this field pumps (from the ramp or its hangar bowser) — the panel
    // shows a Refuel action on a craft whose fuel type is stocked and tank isn't full.
    fuelStocks: fieldStocks(field),
    // The venue the 3D hangar scene renders: a yacht field draws an open-air boat
    // helipad (no roof, sea around the deck) instead of the industrial bay.
    venue: field.flags.yacht ? 'helipad' : 'hangar',
    select: selectId || null,   // client pre-selects this craft (from `view <tail>`)
    pilot: pilotStatusForField(field.id),
    charterWaiting,
    sky: skyState(),   // time-of-day + weather, visible through the open bay door
    canBuy, canRent, lots, licensed, isAdmin,
    catalog: { patterns: PATTERNS, finishes: FINISHES, uphol: UPHOLSTERY, decals: DECALS, presets: PRESETS },
    tuneParams: Object.entries(TUNE_PARAMS).map(([id, p]) => ({ id, label: p.label, lo: p.lo, hi: p.hi, desc: p.desc })),
  } });
  return { type: 'noop' };
}

// Resolve + gate an owned craft the player can paint here (aboard or parked). Returns
// { ac } (the joined row) or { err } for the panel to surface.
async function paintTarget(player, id) {
  if (!id) return { err: { type: 'noop' } };
  const { rows } = await query('SELECT a.*, t.class, t.name tname FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1', [id]);
  const ac = rows[0];
  if (!ac) return { err: { type: 'emote', message: 'No such aircraft.' } };
  if (ac.owner_id !== player.id || !isPaintable(ac)) return { err: { type: 'emote', message: 'You can only repaint an aircraft you own.' } };
  const field = fieldOf(player);
  if (!field || ac.parked_zone_id !== field.id) return { err: { type: 'emote', message: 'Bring her to a hangar to repaint.' } };
  if (liveAircraft.get(id)?.row.airborne) return { err: { type: 'emote', message: "Land first — you can't repaint her in the air." } };
  return { ac };
}

// Persist a livery onto a craft, carrying the saved schemes + hand-written text through.
async function writeLivery(ac, next) {
  const merged = { ...next, text: normalizeLivery(ac.custom_data).text, schemes: readSchemes(ac.custom_data) };
  const cd = { ...(ac.custom_data || {}), livery: merged };
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), ac.id]);
  const live = liveAircraft.get(ac.id); if (live) live.row.custom_data = cd;
}

// Save a paint job from the panel: paintset <id> <base> <trim> <pattern> <finish> <cabin> <uphol> <decal> <accent> <ground>.
// Owner-only, at a field, on the ground. Charges the class-scaled respray fee only when the
// paint actually changed; the hand-written livery text and saved schemes are never touched here.
// (accent/ground trail the arg list so older clients that omit them still parse — they default in place.)
async function cmdPaintset(args, raw, player) {
  const [id, base, trim, pattern, finish, cabin, uphol, decal, accent, ground] = args;
  const { ac, err } = await paintTarget(player, id); if (err) return err;

  const prev = normalizeLivery(ac.custom_data);
  const next = { ...sanitizeLivery({ base, trim, accent, ground, pattern, finish, cabin, uphol, decal }, prev), text: prev.text };
  if (JSON.stringify(next) !== JSON.stringify(prev)) {
    const fee = paintCost({ class: ac.class });
    if ((player.credits || 0) < fee) { await pushHangarBay(player); return { type: 'emote', message: `A respray on the ${ac.tname} runs ${fee}₵ — you're short.` }; }
    player.credits -= fee;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await writeLivery(ac, next);
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    out(player.id, `<span class="item-grant">The ${ac.tname} rolls out of the paint bay in fresh colours — ${fee}₵.</span>`);
  }
  return pushHangarBay(player);
}

// Saved paint schemes (like tune profiles, but for the whole look): scheme <save|load|delete> <name>.
// Saving stashes the craft's CURRENT paint; loading swaps to a saved look for FREE (you paid to
// design it once) — so you can keep several liveries and change on a whim.
async function cmdScheme(args, raw, player) {
  const { id, rest: a } = popCraftId(args);
  const sub = (a[0] || '').toLowerCase();
  const name = clean(a.slice(1).join(' ')).toLowerCase().slice(0, 16);
  const owned = await ownedCraft(player, id);
  if (owned?.notOwned) return { type: 'emote', message: 'You can only manage schemes on an aircraft you own.' };
  if (!owned) return { type: 'emote', message: 'No aircraft of your own here.' };
  if (owned.live?.row.airborne) return { type: 'emote', message: 'Land first.' };
  if (!fieldOf(player)) return { type: 'emote', message: 'Do it at a field.' };
  const { rows } = await query('SELECT id, custom_data FROM aircraft WHERE id=$1', [owned.id]);
  const cd = rows[0]?.custom_data || {};
  const schemes = { ...readSchemes(cd) };

  if (sub === 'save') {
    if (!name) return { type: 'emote', message: 'Name the scheme: <b>scheme save &lt;name&gt;</b>.' };
    schemes[name] = schemeOf(cd.livery);
    await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify({ ...cd, livery: { ...normalizeLivery(cd), schemes } }), owned.id]);
    if (owned.live) owned.live.row.custom_data = { ...cd, livery: { ...normalizeLivery(cd), schemes } };
    out(player.id, `<span class="item-grant">Saved this look as scheme "${name}".</span>`);
    return pushHangarBay(player);
  }
  if (sub === 'load') {
    if (!schemes[name]) return { type: 'emote', message: `No saved scheme "${name}".` };
    await writeLivery({ id: owned.id, custom_data: cd }, sanitizeLivery(schemes[name], normalizeLivery(cd)));
    out(player.id, `<span class="item-grant">Swapped to scheme "${name}" — no charge.</span>`);
    return pushHangarBay(player);
  }
  if (sub === 'delete' || sub === 'del') {
    if (!schemes[name]) return { type: 'emote', message: `No saved scheme "${name}".` };
    delete schemes[name];
    await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify({ ...cd, livery: { ...normalizeLivery(cd), schemes } }), owned.id]);
    if (owned.live) owned.live.row.custom_data = { ...cd, livery: { ...normalizeLivery(cd), schemes } };
    return pushHangarBay(player);
  }
  return { type: 'emote', message: 'scheme <save|load|delete> &lt;name&gt;' };
}

// Panel button actions that mutate then re-render: hangaract <store|pull> <id>.
async function cmdHangarAct(args, raw, player) {
  const op = (args[0] || '').toLowerCase(), id = args[1];
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Hangars are at the airfields.' };
  const { rows: mine } = await query('SELECT id FROM hangars WHERE field_zone=$1 AND owner_id=$2', [field.id, player.id]);
  if ((op === 'store' || op === 'pull') && !mine.length) { await pushHangarBay(player); return { type: 'emote', message: 'You need to <b>hangar rent</b> a bay here first.' }; }
  if (op === 'store' && id) {
    await query('UPDATE aircraft SET hangar_id=$1 WHERE id=$2 AND owner_id=$3 AND parked_zone_id=$4 AND is_wreck=0 AND hangar_id IS NULL', [mine[0].id, id, player.id, field.id]);
  } else if (op === 'pull' && id) {
    await query('UPDATE aircraft SET hangar_id=NULL, parked_zone_id=$1 WHERE id=$2 AND hangar_id=$3', [field.id, id, mine[0].id]);
  }
  return pushHangarBay(player);
}

// `fleet`/`carousel` are legacy aliases for the same unified hangar-bay — kept as
// commands (so old muscle memory and any linked text still works) but they open
// the identical floor pushHangarBay already builds (craft + buy/rent catalogs).
const cmdFleet = (args, raw, player) => pushHangarBay(player);

// ── Hangars ───────────────────────────────────────────────────────────────────
// `showroom` is a friendlier alias for opening the visual hangar — the 3D turntable
// view of your aircraft. Same panel as bare `hangar`; it just reads better for "let
// me look at my planes" and is what the in-room hint points at.
async function cmdShowroom(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Your aircraft are at the airfields — the showroom is there (or in a hangar).' };
  return pushHangarBay(player);
}

// `view <tail>` — open the showroom already turned to one aircraft, matched by tail/
// name, type, or id among the craft here. Bare `view` just opens the floor. `view` is
// a generic word, so away from a field we return undefined to fall through rather than
// hijack it — flight only owns `view` when you're actually at an airfield/hangar.
async function cmdView(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return undefined;
  const want = args.join(' ').trim().toLowerCase();
  if (!want) return pushHangarBay(player);
  const cards = await buildCards(player, field);
  if (!cards.length) return { type: 'emote', message: 'None of your aircraft are here to view.' };
  const hit = cards.find(c => c.id === want)
    || cards.find(c => (c.tail || '').toLowerCase() === want)
    || cards.find(c => (c.tail || '').toLowerCase().includes(want) || (c.typeName || '').toLowerCase().includes(want) || c.id.includes(want));
  if (!hit) {
    const names = cards.map(c => `<b>${clean(c.tail)}</b>`).join(', ');
    return { type: 'emote', message: `No aircraft here matches "${clean(want)}". On the floor: ${names}.` };
  }
  return pushHangarBay(player, hit.id);
}

async function cmdHangar(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Hangars are at the airfields.' };
  const sub = (args[0] || '').toLowerCase();
  const { rows: mine } = await query('SELECT * FROM hangars WHERE field_zone=$1 AND owner_id=$2', [field.id, player.id]);

  // Bare `hangar` opens the visual hangar. `hangar list` keeps the old text view.
  if (!sub || sub === 'open' || sub === 'panel') return pushHangarBay(player);

  if (sub === 'list') {
    const { rows: stored } = await query('SELECT a.name, t.name tname FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.hangar_id IN (SELECT id FROM hangars WHERE field_zone=$1 AND owner_id=$2)', [field.id, player.id]);
    const head = `<span class="text-cyan">HANGARS — ${fieldName(field)}:</span>`;
    if (!mine.length) return { type: 'output', message: `${head}\nYou rent no hangar here. <span class="action-link" data-action="cmd" data-cmd="hangar rent">hangar rent</span> — ${200}₵/period, and your craft is safe from thieves.` };
    const list = stored.length ? stored.map(s => `· ${s.tname} "${s.name}"`).join('\n') : '· (empty)';
    return { type: 'output', message: `${head}\nYour hangar (${mine[0].name}). Stored:\n${list}\n<span class="action-link" data-action="cmd" data-cmd="hangar store">hangar store</span> · <span class="action-link" data-action="cmd" data-cmd="hangar pull">hangar pull</span>` };
  }

  if (sub === 'rent') {
    if (mine.length) return { type: 'emote', message: 'You already rent a hangar here.' };
    const cost = 200;
    if ((player.credits || 0) < cost) return { type: 'emote', message: `A hangar runs ${cost}₵/period — you're short.` };
    player.credits -= cost;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await query('INSERT INTO hangars (id,field_zone,name,owner_id,rent_paid_until,rent_per_period) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), field.id, `Bay ${Math.floor(Math.random() * 40 + 1)}`, player.id, nowSec() + 7 * 86400, cost]);
    return { type: 'output', message: `<span class="item-grant">Hangar rented. Your aircraft is safe behind a locked door here now — <b>hangar store</b> to put one away.</span>`, player_update: { credits: player.credits } };
  }

  if (sub === 'store' || sub === 'pull') {
    if (!mine.length) return { type: 'emote', message: 'You need to <b>hangar rent</b> a bay here first.' };
    const want = (args[1] || '').toLowerCase();   // optional aircraft id/name; else the first
    if (sub === 'store') {
      const { rows } = await query('SELECT id, name FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 AND hangar_id IS NULL', [field.id, player.id]);
      const pick = want ? rows.find(r => r.id.includes(want) || (r.name || '').toLowerCase().includes(want)) : rows[0];
      if (!pick) return { type: 'emote', message: 'No aircraft of yours parked out on the ramp here to store.' };
      await query('UPDATE aircraft SET hangar_id=$1 WHERE id=$2', [mine[0].id, pick.id]);
      return { type: 'emote', message: `You tow "${pick.name}" into the hangar and roll the door down. Safe.` };
    }
    const { rows } = await query('SELECT id, name FROM aircraft WHERE hangar_id=$1', [mine[0].id]);
    const pick = want ? rows.find(r => r.id.includes(want) || (r.name || '').toLowerCase().includes(want)) : rows[0];
    if (!pick) return { type: 'emote', message: 'The hangar\'s empty.' };
    await query('UPDATE aircraft SET hangar_id=NULL, parked_zone_id=$1 WHERE id=$2', [field.id, pick.id]);
    return { type: 'emote', message: `You roll "${pick.name}" out onto the ramp, ready to fly.` };
  }
  return { type: 'emote', message: 'hangar <rent|store|pull|list>' };
}

// ── Maintenance ───────────────────────────────────────────────────────────────
async function cmdRepair(args, raw, player) {
  // `repair` shadows the engine gear-repair builtin. Only claim it when there's an
  // aircraft to work on; otherwise return undefined so the builtin repairs gear.
  // The panel names its craft explicitly (see popCraftId) — if it does, a miss is
  // a real error, not a silent fall-through to gear repair.
  const { id, rest: a } = popCraftId(args);
  const tgt = await targetCraft(player, id);
  if (!tgt) return id ? { type: 'emote', message: 'No such aircraft of yours to repair.' } : undefined;
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Aircraft repairs happen at a field with tools.' };
  const { rows } = await query('SELECT a.damage, a.rental, t.name, t.hull_hp FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1', [tgt.id]);
  const ac = rows[0];
  if (!ac) return { type: 'emote', message: 'Nothing here to work on.' };
  if (ac.damage <= 0.02) return { type: 'emote', message: `The ${ac.name} is already in fine shape.` };

  // A RENTAL's upkeep is on the desk (bundled into the meter) — they just square her away.
  if (ac.rental) {
    await query("UPDATE aircraft SET damage=0, custom_data = COALESCE(custom_data,'{}'::jsonb) - 'surfaces' WHERE id=$1", [tgt.id]);
    if (tgt.live) { tgt.live.row.damage = 0; resetSurfaces(tgt.live.row); }
    return { type: 'output', message: `<span class="item-grant">The rental desk's mechanics square the ${ac.name} away — no charge, maintenance is on your rental. Hull back to 100%.</span>` };
  }

  // You OWN her → you pay. Two ways: DIY (Fabrication-checked, cheaper, botchable) or pay the
  // hangar to do it right (dear, but a guaranteed full fix — no skill roll, no botch).
  const pro = /^(pay|hangar|pro|full|shop)$/.test((a[0] || '').toLowerCase());
  if (pro) {
    const cost = Math.ceil(ac.damage * ac.hull_hp * 15);   // ~2.5× DIY — you pay for certainty
    if ((player.credits || 0) < cost) return { type: 'emote', message: `The hangar wants ${cost}₵ for a full shop repair — you're short. (Or <b>repair</b> her yourself for less.)` };
    player.credits -= cost;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await query("UPDATE aircraft SET damage=0, custom_data = COALESCE(custom_data,'{}'::jsonb) - 'surfaces' WHERE id=$1", [tgt.id]);
    if (tgt.live) { tgt.live.row.damage = 0; resetSurfaces(tgt.live.row); }
    return { type: 'output', message: `<span class="item-grant">The hangar's mechanics do it right — the ${ac.name} is back to 100% for ${cost}₵.</span>`, player_update: { credits: player.credits } };
  }

  const cost = Math.ceil(ac.damage * ac.hull_hp * 6);
  if ((player.credits || 0) < cost) return { type: 'emote', message: `Parts for a DIY repair run ~${cost}₵ — you're short.` };
  const chk = await skillCheck(player, 'fabrication', 5);
  const fixed = chk.success ? ac.damage : ac.damage * 0.5;   // botch it and you only get half back
  player.credits -= cost;
  const newDmg = Math.max(0, ac.damage - fixed);
  const full = newDmg === 0;   // a full field fix reattaches structure; a botched partial leaves the wing hanging
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query(`UPDATE aircraft SET damage=$1${full ? ", custom_data = COALESCE(custom_data,'{}'::jsonb) - 'surfaces'" : ''} WHERE id=$2`, [newDmg, tgt.id]);
  if (tgt.live) { tgt.live.row.damage = newDmg; if (full) resetSurfaces(tgt.live.row); }
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  const proCost = Math.ceil(ac.damage * ac.hull_hp * 15);
  return { type: 'output', message: `<span class="item-grant">You work the ${ac.name} over yourself — hull to ${Math.round((1 - newDmg) * 100)}% for ${cost}₵.</span>${chk.success ? '' : ' <span class="text-amber">(Botched some of it.)</span>'} <span class="text-dim">Or <b>repair hangar</b> next time — ${proCost}₵, done right.</span>`, player_update: { credits: player.credits } };
}

// ── Wreck salvage + Carcass rebuild ───────────────────────────────────────────
async function cmdSalvage(args, raw, player) {
  const { rows } = await query('SELECT a.id, t.name, t.hull_hp, t.price_buy FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1 AND a.is_wreck=1 LIMIT 1', [player.current_zone]);
  const w = rows[0];
  if (!w) return { type: 'emote', message: "There's no wreck here to strip." };
  const chk = await skillCheck(player, 'scavenging', 5);
  const scrap = Math.ceil((w.price_buy || 400) * 0.05 * (chk.success ? 1.6 : 0.8));
  player.credits = (player.credits || 0) + scrap;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await awardSkillUse(player.id, 'scavenging', chk.margin);
  // Stripping guts the wreck: after it's picked over it can no longer be rebuilt.
  await query("UPDATE aircraft SET custom_data = jsonb_set(COALESCE(custom_data,'{}'), '{stripped}', 'true') WHERE id=$1", [w.id]);
  // …and it can hand you a COMPONENT. This is the free source the shelf isn't: a
  // wreck out in the wastes is the reason to go and look at a wreck out in the
  // wastes. Only ever tier 1 — the exotic hardware is bought, not scavenged — and
  // whatever the wreck was carrying stays with the wreck it came off.
  let found = null;
  if (chk.success && Math.random() < 0.45) {
    const pool = Object.keys(PARTS).filter(k => PARTS[k].tier === 1);
    const key = pool[Math.floor(Math.random() * pool.length)];
    found = PARTS[key];
    await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,0.7)',
      [randomUUID(), player.id, found.item]);
    emit('inventory.changed', { actor: player });
  }
  return { type: 'output', message: `<span class="item-grant">You strip the ${w.name} wreck for parts and scrap — <b>${scrap}₵</b> of salvage.</span>` +
    (found ? `\n<span class="item-grant">And something worth having: a <b>${found.name}</b>, tired but whole. <span class="text-dim">(<b>modify fit</b> it at a hangar.)</span></span>` : ''),
    player_update: { credits: player.credits } };
}

async function cmdRebuild(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'You can only rebuild a wreck at a field with a hangar.' };
  const { rows } = await query('SELECT a.id, a.custom_data, t.name FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1 AND a.is_wreck=1 LIMIT 1', [player.current_zone]);
  const w = rows[0];
  if (!w) return { type: 'emote', message: 'No wreck here to rebuild.' };
  if (w.custom_data?.stripped) return { type: 'emote', message: "This wreck's been stripped to the frame — nothing left to rebuild." };
  const cost = 1500;
  if ((player.credits || 0) < cost) return { type: 'emote', message: `A rebuild runs ${cost}₵ in parts — you're short.` };
  const mech = await skillCheck(player, 'fabrication', 8);
  const chem = await skillCheck(player, 'chemistry', 6);
  if (!mech.success || !chem.success) return { type: 'emote', message: 'You can\'t make it airworthy with what you\'ve got — you need cleaner hands at Fabrication and Chemistry. (Try again.)' };
  // A rebuilt Carcass rolls a random real type.
  const { rows: types } = await query("SELECT id, name FROM aircraft_types WHERE class <> 'wreck' ORDER BY random() LIMIT 1");
  const rolled = types[0];
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query("UPDATE aircraft SET is_wreck=0, damage=0.5, type_id=$1, owner_id=$2, engine_on=0, throttle=0, parked_zone_id=$3, custom_data = COALESCE(custom_data,'{}'::jsonb) - 'surfaces' WHERE id=$4",
    [rolled.id, player.id, field.id, w.id]);
  await awardSkillUse(player.id, 'fabrication', mech.margin);
  return { type: 'output', message: `<span class="item-grant">Against the odds, the wreck lives — it rebuilds into a battered but flyable <b>${rolled.name}</b>, now yours (hull 50%). She'll need a real repair before she's safe.</span>`, player_update: { credits: player.credits } };
}

// ── Tuning ────────────────────────────────────────────────────────────────────
// Each knob carries a label, the two dial poles (lo = −, hi = +), and a plain-English
// description. The physics of these curves live in state.computeStats (one source of
// truth for flight + graphs); this is just how the bench presents them.
const TUNE_PARAMS = {
  mixture: { label: 'Mixture',     lo: 'RICH',  hi: 'LEAN',   desc: 'Lean (+) saves fuel but runs hot and sheds a little power; rich (−) runs cool and thirsty with more low-end grunt.' },
  pitch:   { label: 'Prop Pitch',  lo: 'FINE',  hi: 'COARSE', desc: 'Coarse (+) cruises faster but climbs poorly; fine (−) climbs and takes off better for less top speed.' },
  boost:   { label: 'Boost',       lo: 'LOW',   hi: 'HIGH',   desc: 'More power for speed (+) — paid for in heat, fuel and a twitchier, less reliable machine.' },
  cg:      { label: 'Balance / CG', lo: 'NOSE', hi: 'TAIL',   desc: 'Tail-heavy (+) is agile but stall-prone; nose-heavy (−) is stable and forgiving but sluggish.' },
};

// Clamp a knob value to the reachable range (Fabrication + installed kits) and round
// to a clean two decimals for storage. Shared by the chat shortcut and the dial panel.
function clampTune(val, range) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(-range, Math.min(range, n)) * 100) / 100;
}

// Shared: set one tuning curve (chat shortcut — the panel uses cmdTuneset to commit
// all four dials at once). Mechanics (Fabrication) + kits set how far you can push.
async function setCurve(player, tgt, param, valRaw) {
  const cd = await loadCd(tgt);
  const eff = await effectiveSkill(player, 'fabrication');
  const range = tuneRange(eff, installedKits(cd), partDefs(cd), param);
  const val = clampTune(valRaw, range);
  if (val == null) return { type: 'emote', message: `Set it to what? e.g. <b>modify ${param} 1</b> (−${range}..+${range}).` };
  cd.tune = { ...(cd.tune || {}), [param]: val };
  await saveCd(tgt, cd);
  await awardSkillUse(player.id, 'fabrication', 0);
  const capped = Math.abs(val) >= range;
  return { type: 'output', message: `<span class="item-grant">Set ${param} to ${val > 0 ? '+' : ''}${val}.</span>${capped ? ' <span class="text-dim">(That\'s as far as your hands and gear will take it — fit a kit or a better part to push further.)</span>' : ''}` };
}

// Commit all four dials at once from the bench panel: tuneset <id> <mixture> <pitch>
// <boost> <cg> (floats). Owner-gated, at a field, on the ground — then re-pushes the
// hangar bay so the graph shows the now-authoritative numbers.
async function cmdTuneset(args, raw, player) {
  const { id, rest: a } = popCraftId(args);
  const { tgt, err } = await requireOwned(player, id); if (err) return err;
  const cd = await loadCd(tgt);
  const eff = await effectiveSkill(player, 'fabrication');
  const parts = partDefs(cd);
  // Per-knob, because some parts widen only the knob they are about: a hot section
  // buys boost travel and a spar set buys CG travel, and neither buys the other.
  const rangeFor = k => tuneRange(eff, installedKits(cd), parts, k);
  const [m, p, b, c] = a;
  cd.tune = {
    mixture: clampTune(m, rangeFor('mixture')) ?? 0, pitch: clampTune(p, rangeFor('pitch')) ?? 0,
    boost: clampTune(b, rangeFor('boost')) ?? 0, cg: clampTune(c, rangeFor('cg')) ?? 0,
  };
  await saveCd(tgt, cd);
  await awardSkillUse(player.id, 'fabrication', 0);
  out(player.id, '<span class="item-grant">Tune dialed in and committed to the aircraft.</span>');
  return pushHangarBay(player);
}

// Buy + fit an upgrade kit from the bench panel: installkit <id> <kitId>. Owner-gated,
// at a field, on the ground; charges the kit price and re-pushes (its effect widens
// the dials / bends the physics via state.KITS).
async function cmdInstallKit(args, raw, player) {
  const { id, rest: a } = popCraftId(args);
  const { tgt, err } = await requireOwned(player, id); if (err) return err;
  const kitId = (a[0] || '').toLowerCase();
  const kit = KITS[kitId];
  if (!kit) return { type: 'emote', message: 'No such kit.' };
  const cd = await loadCd(tgt);
  const kits = installedKits(cd);
  if (kits.includes(kitId)) { await pushHangarBay(player); return { type: 'emote', message: `The ${kit.name} is already fitted.` }; }
  if ((player.credits || 0) < kit.price) { await pushHangarBay(player); return { type: 'emote', message: `The ${kit.name} runs ${kit.price}₵ — you're short.` }; }
  player.credits -= kit.price;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  cd.kits = [...kits, kitId];
  await saveCd(tgt, cd);
  await awardSkillUse(player.id, 'fabrication', 0);
  out(player.id, `<span class="item-grant">Fitted the ${kit.name} — ${kit.price}₵.</span>`);
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  return pushHangarBay(player);
}

// ── Parts & slots (the discrete layer) ────────────────────────────────────────
// Every path here goes through `modify` rather than new verbs: `install`/`uninstall`
// are the doors and augments plugins' and `parts` is trucking's, and a plugin verb
// silently beats both the engine builtin and the other plugin depending on load
// order. The customisation sheet was already the surface for this — a part is one
// more thing on it.
//
// The part itself is an inventory ITEM. So fitting CONSUMES a row out of your kit and
// pulling puts one back, which is what makes a part something you can buy, find on a
// wreck, carry home and sell to somebody else without any of that being written here.

// The type row a slot check needs (the live craft has it; a parked one doesn't).
async function craftType(tgt) {
  if (tgt.live?.type) return tgt.live.type;
  const { rows } = await query(
    'SELECT t.* FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1', [tgt.id]);
  return rows[0] || {};
}

// One line per part in the player's hands, for the "what can I fit" half of the sheet.
async function heldParts(player) {
  const ids = Object.keys(PARTS).map(k => PARTS[k].item);
  const { rows } = await query(
    'SELECT item_id, COUNT(*)::int n FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2) GROUP BY item_id',
    [player.id, ids]);
  const byItem = Object.fromEntries(Object.values(PARTS).map(p => [p.item, p]));
  return rows.map(r => ({ part: byItem[r.item_id], n: r.n })).filter(x => x.part);
}

// The parts sheet: what she's wearing, what's in your hands, what the shelf sells.
async function partsSheet(player, tgt) {
  const cd = await loadCd(tgt), type = await craftType(tgt);
  const fitted = installedParts(cd), slots = slotsFor(type);
  const env = partEnvelope(partDefs(cd));
  const held = await heldParts(player);
  const lines = slots.map(s => {
    const p = PARTS[fitted[s.id]];
    const fit = p
      ? `<b>${p.name}</b> <span class="text-dim">(tier ${p.tier}, ${p.kg}kg)</span> · <span class="action-link" data-action="cmd" data-cmd="modify pull ${s.id}">pull</span>`
      : '<span class="text-dim">— empty —</span>';
    return `· <span class="text-cyan">${s.label.padEnd(11)}</span> ${fit}`;
  });
  const canFit = held.filter(h => slots.some(s => s.id === h.part.slot));
  const hand = canFit.length
    ? canFit.map(h => `· <b>${h.part.name}</b>${h.n > 1 ? ` ×${h.n}` : ''} <span class="text-dim">(${h.part.slot})</span> · <span class="action-link" data-action="cmd" data-cmd="modify fit ${partKeyOf(h.part)}">fit</span>`).join('\n')
    : '<span class="text-dim">Nothing in your kit this airframe can take.</span>';
  const shelf = Object.entries(PARTS)
    .filter(([, p]) => slots.some(s => s.id === p.slot))
    .map(([k, p]) => `· <b>${p.name}</b> <span class="text-dim">(${p.slot}, tier ${p.tier})</span> — ${p.price}₵ · <span class="action-link" data-action="cmd" data-cmd="modify buy ${k}">buy</span>\n  <span class="text-dim">${p.blurb}</span>`);
  const carried = env.kg ? `\n<span class="text-dim">Fitted hardware weighs ${env.kg}kg — payload you are already carrying.</span>` : '';
  return { type: 'output', message:
    `<span class="text-cyan">PARTS — ${type.name || 'aircraft'}:</span>\n${lines.join('\n')}${carried}\n` +
    `<b>IN YOUR KIT:</b>\n${hand}\n<b>THE SHELF:</b>\n${shelf.join('\n')}` };
}
const partKeyOf = (part) => Object.keys(PARTS).find(k => PARTS[k] === part);

// Resolve "what part did they mean" from a catalogue key, an item id, or a name
// fragment — the same forgiving match the rest of the bench uses.
function findPart(words) {
  const w = (words || '').toLowerCase().trim();
  if (!w) return null;
  if (PARTS[w]) return w;
  return Object.keys(PARTS).find(k =>
    PARTS[k].item === w || k.endsWith(w) || PARTS[k].name.toLowerCase().includes(w)) || null;
}

// Buy a part over the bench: it goes into your HANDS, not into the aircraft. Two acts,
// deliberately — a part you own and haven't fitted is a tradeable object, and the
// fitting is a job with a skill check that can go wrong.
async function cmdBuyPart(player, tgt, words) {
  const key = findPart(words);
  if (!key) return { type: 'emote', message: 'No such part on the shelf. <b>modify parts</b> for the list.' };
  const part = PARTS[key];
  const type = await craftType(tgt);
  if (!slotsFor(type).some(s => s.id === part.slot))
    return { type: 'emote', message: `The ${type.name} has no ${part.slot} slot — nowhere to hang it.` };
  if ((player.credits || 0) < part.price) return { type: 'emote', message: `The ${part.name} runs ${part.price}₵ — you're short.` };
  player.credits -= part.price;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
    [randomUUID(), player.id, part.item]);
  emit('inventory.changed', { actor: player });
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  return { type: 'output', message: `<span class="item-grant">The counter man drags the ${part.name} out of the back — ${part.price}₵. It's yours; now get it fitted (<b>modify fit ${key}</b>).</span>`,
    player_update: { credits: player.credits } };
}

// Fit a part you are carrying. Consumes the item on a Fabrication check; a failure
// costs you the afternoon, never the part — the bench is where you learn, and a
// component destroyed by a bad roll would make trying it a gamble nobody takes.
async function cmdFitPart(player, tgt, words) {
  const key = findPart(words);
  if (!key) return { type: 'emote', message: 'Fit what? <b>modify parts</b> lists what you\'re carrying.' };
  const part = PARTS[key];
  const type = await craftType(tgt);
  if (!slotsFor(type).some(s => s.id === part.slot))
    return { type: 'emote', message: `The ${type.name} has no ${part.slot} slot. That one stays in the crate.` };
  const { rows } = await query(
    'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1',
    [player.id, part.item]);
  if (!rows.length) return { type: 'emote', message: `You haven't got a ${part.name} on you.` };
  const cd = await loadCd(tgt), fitted = installedParts(cd);
  if (fitted[part.slot] === key) return { type: 'emote', message: `That ${part.name} is already in her.` };
  if (fitted[part.slot]) return { type: 'emote', message: `The ${part.slot} slot is full — <b>modify pull ${part.slot}</b> first. One airframe, one ${part.slot}.` };
  const chk = await skillCheck(player, 'fabrication', 4 + part.tier * 3);
  if (!chk.success) {
    await awardSkillUse(player.id, 'fabrication', chk.margin);
    return { type: 'emote', message: `You get the ${part.name} half in and nothing lines up. Shims, swearing, and it comes back out. <span class="text-dim">(Try again.)</span>` };
  }
  await query('DELETE FROM player_inventory WHERE id=$1', [rows[0].id]);
  emit('inventory.changed', { actor: player });
  cd.parts = { ...(cd.parts || {}), [part.slot]: key };
  await saveCd(tgt, cd);
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  out(player.id, `<span class="item-grant">Fitted: <b>${part.name}</b>. ${part.blurb}</span>`);
  await pushHangarBay(player).catch(() => {});
  return { type: 'output', message: '<span class="text-dim">Cowlings back on, panels screwed down. She\'s a different aeroplane.</span>' };
}

// Pull a fitted part back into your hands. A botch is where a part CAN die: taking
// something out that is already bolted in and safetied is the job where a slipped
// spanner ruins the component, and the risk is what makes a swap a decision.
async function cmdPullPart(player, tgt, words) {
  const w = (words || '').toLowerCase().trim();
  const cd = await loadCd(tgt), fitted = installedParts(cd);
  const slot = PART_SLOTS.find(s => s.id === w)?.id
    || (findPart(w) && PARTS[findPart(w)].slot)
    || (Object.keys(fitted).length === 1 ? Object.keys(fitted)[0] : null);
  if (!slot) return { type: 'emote', message: `Pull what? <b>modify pull &lt;${PART_SLOTS.map(s => s.id).join('|')}&gt;</b>` };
  const key = fitted[slot];
  if (!key) return { type: 'emote', message: `There's nothing in the ${slot} slot.` };
  const part = PARTS[key];
  const chk = await skillCheck(player, 'fabrication', 5 + part.tier * 3);
  delete cd.parts[slot];
  await saveCd(tgt, cd);
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  if (!chk.success) {
    await pushHangarBay(player).catch(() => {});
    return { type: 'output', message: `<span class="text-amber">It comes out — in pieces. The ${part.name} is scrap, and the slot's empty.</span>` };
  }
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
    [randomUUID(), player.id, part.item]);
  emit('inventory.changed', { actor: player });
  await pushHangarBay(player).catch(() => {});
  return { type: 'output', message: `<span class="item-grant">Out it comes, clean — the <b>${part.name}</b> is in your hands and the slot is empty.</span>` };
}

// Gate every customisation path: must own the craft, at a field, on the ground.
async function requireOwned(player, id) {
  const tgt = await ownedCraft(player, id);
  if (tgt?.notOwned) return { err: { type: 'emote', message: 'You can only modify an aircraft you <b>own</b> — this one isn\'t yours.' } };
  if (!tgt) return { err: { type: 'emote', message: 'No aircraft of your own here to modify. Buy one at a dealer field.' } };
  if (tgt.live?.row.airborne) return { err: { type: 'emote', message: 'Land first — you can\'t work on her in the air.' } };
  if (!fieldOf(player)) return { err: { type: 'emote', message: 'Modifications need a hangar\'s tools — do it at a field.' } };
  return { tgt };
}

// The full customisation sheet.
async function showSheet(player, tgt) {
  const cd = await loadCd(tgt), tune = cd.tune || {};
  const { rows } = await query('SELECT a.name, t.name tname, t.class FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1', [tgt.id]);
  const ac = rows[0] || {};
  const curves = Object.entries(TUNE_PARAMS).map(([k, d]) => {
    const v = tune[k] ?? 0, next = v >= 2 ? -2 : v + 1;
    return `· <b>${k}</b> [${v > 0 ? '+' : ''}${v}] — ${d.desc} · <span class="action-link" data-action="cmd" data-cmd="modify ${k} ${next}">cycle</span>`;
  });
  const profs = Object.keys(cd.profiles || {});
  const fitted = installedParts(cd);
  const partLine = Object.entries(fitted).length
    ? Object.entries(fitted).map(([slot, k]) => `${slot}: <b>${PARTS[k].name}</b>`).join(' · ')
    : '<span class="text-dim">all stock</span>';
  const lv = normalizeLivery(cd);
  return { type: 'output', message:
    `<span class="text-cyan">MODIFY — ${ac.tname} "${clean(ac.name)}" (${ac.class}):</span>\n` +
    `<b>TUNING</b> (−2..+2, wider with Fabrication):\n${curves.join('\n')}\n` +
    `<b>PARTS:</b> ${partLine}  ·  <span class="action-link" data-action="cmd" data-cmd="modify parts">open the parts bench</span>\n` +
    `<b>PAINT:</b> ${lv.pattern === 'bare' ? 'bare metal' : `${lv.finish} · ${lv.pattern}`}  ·  <span class="action-link" data-action="cmd" data-cmd="hangar">open the paint bay</span>\n` +
    `<b>MARKINGS:</b> ${lv.text ? clean(lv.text) : '<span class="text-dim">none</span>'}  ·  <span class="text-dim">modify livery &lt;text&gt;</span>\n` +
    `<b>TAIL:</b> ${clean(ac.name)}  ·  <span class="text-dim">modify name &lt;text&gt;</span>\n` +
    `<b>PROFILES:</b> ${profs.length ? profs.join(', ') : '<span class="text-dim">none</span>'}  ·  <span class="text-dim">modify save/load &lt;name&gt;</span>` };
}

// Umbrella customisation verb — everything adjustable on a craft you own.
async function cmdModify(args, raw, player) {
  const { id, rest: a } = popCraftId(args);
  const { tgt, err } = await requireOwned(player, id); if (err) return err;
  const sub = (a[0] || '').toLowerCase();
  const rest = clean(a.slice(1).join(' ')).slice(0, 40);

  if (!sub) return showSheet(player, tgt);
  if (TUNE_PARAMS[sub]) return setCurve(player, tgt, sub, a[1]);

  // The discrete layer. Deliberately sub-verbs rather than top-level ones — see the
  // comment over the parts section for which plugins already own install/uninstall/parts.
  if (sub === 'parts' || sub === 'slots') return partsSheet(player, tgt);
  if (sub === 'fit') return cmdFitPart(player, tgt, a.slice(1).join(' '));
  if (sub === 'pull' || sub === 'remove') return cmdPullPart(player, tgt, a.slice(1).join(' '));
  if (sub === 'buy' || sub === 'order') return cmdBuyPart(player, tgt, a.slice(1).join(' '));

  if (sub === 'name' || sub === 'tail') {
    if (!rest) return { type: 'emote', message: 'Re-letter her to what? <b>modify name &lt;text&gt;</b>' };
    const name = rest.slice(0, 24);
    await query('UPDATE aircraft SET name=$1 WHERE id=$2', [name, tgt.id]);
    if (tgt.live) tgt.live.row.name = name;
    return { type: 'output', message: `<span class="item-grant">Tail re-lettered: <b>${name}</b>.</span>` };
  }
  if (sub === 'paint') {
    return { type: 'output', message: 'Open the <span class="action-link" data-action="cmd" data-cmd="hangar">paint bay</span> to respray her — colours, pattern, finish, and cabin.' };
  }
  if (sub === 'livery') {
    // The hand-written markings line that rides under the auto-generated paint
    // description in the room examine. Colours/pattern live in the paint bay.
    const cd = await loadCd(tgt); cd.livery = { ...normalizeLivery(cd), text: rest.slice(0, 80) }; await saveCd(tgt, cd);
    return { type: 'output', message: rest ? `<span class="item-grant">Markings noted: ${rest}.</span>` : 'You scrub off the custom markings.' };
  }
  if (sub === 'save') {
    const pname = clean(a[1] || 'default').toLowerCase().slice(0, 16);
    const cd = await loadCd(tgt); cd.profiles = { ...(cd.profiles || {}), [pname]: { ...(cd.tune || {}) } }; await saveCd(tgt, cd);
    return { type: 'output', message: `<span class="item-grant">Saved tune profile "${pname}".</span>` };
  }
  if (sub === 'load') {
    const pname = clean(a[1] || 'default').toLowerCase().slice(0, 16);
    const cd = await loadCd(tgt); const p = cd.profiles?.[pname];
    if (!p) return { type: 'emote', message: `No saved profile "${pname}". Save one with <b>modify save &lt;name&gt;</b>.` };
    cd.tune = { ...p }; await saveCd(tgt, cd);
    return { type: 'output', message: `<span class="item-grant">Loaded tune profile "${pname}" onto the aircraft.</span>` };
  }
  return { type: 'emote', message: 'modify — <b>&lt;mixture|pitch|boost|cg&gt; &lt;−2..2&gt;</b> · <b>parts</b> · <b>fit/pull/buy &lt;part&gt;</b> · <b>name</b> · <b>livery</b> · <b>save/load &lt;profile&gt;</b>' };
}

// `tune` stays as the quick curve shortcut — now owner-gated, still delegating to
// the broadcast channel-tune when you're not near an aircraft of yours.
async function cmdTune(args, raw, player, broadcast) {
  const tgt = await ownedCraft(player);
  if (!tgt) return broadcastCommands.tune(args, raw, player, broadcast);
  if (tgt.notOwned) return { type: 'emote', message: 'You can only tune an aircraft you own.' };
  if (tgt.live?.row.airborne) return { type: 'emote', message: 'Land first — you can\'t tune her in the air.' };
  if (!fieldOf(player)) return { type: 'emote', message: 'Tuning needs a hangar\'s tools — do it at a field.' };
  const param = (args[0] || '').toLowerCase();
  if (!param) return showSheet(player, tgt);
  if (!TUNE_PARAMS[param]) return { type: 'emote', message: `Can't tune "${param}". Options: ${Object.keys(TUNE_PARAMS).join(', ')}, or <b>modify</b> for the full sheet.` };
  return setCurve(player, tgt, param, args[1]);
}

// ── Cabin loadout — weight & balance (passengers ⇄ cargo) ─────────────────────
// Works on a craft you own OR are renting, aboard or parked at this field. A configurable
// hauler carries one fixed payload budget you split between seats (each SEAT_KG) and cargo,
// so you can rig it for people or for freight. Reconfiguring is a ground/hangar job.
async function loadoutTarget(player, id) {
  if (id) {
    const { rows } = await query('SELECT * FROM aircraft WHERE id=$1 AND is_wreck=0 AND (owner_id=$2 OR rental=1)', [id, player.id]);
    if (!rows.length) return null;
    const { rows: t } = await query('SELECT * FROM aircraft_types WHERE id=$1', [rows[0].type_id]);
    if (!t.length) return null;
    return { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null, row: rows[0], type: t[0] };
  }
  if (player.aircraftId) { const l = liveAircraft.get(player.aircraftId); if (l) return { id: l.row.id, live: l, row: l.row, type: l.type }; }
  const field = fieldOf(player);
  if (!field) return null;
  const { rows } = await query(
    'SELECT * FROM aircraft WHERE parked_zone_id=$1 AND is_wreck=0 AND (owner_id=$2 OR rental=1) LIMIT 1',
    [field.id, player.id]);
  if (!rows.length) return null;
  const { rows: t } = await query('SELECT * FROM aircraft_types WHERE id=$1', [rows[0].type_id]);
  if (!t.length) return null;
  return { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null, row: rows[0], type: t[0] };
}

async function cmdLoadout(args, raw, player) {
  const { id, rest: a } = popCraftId(args);
  const tgt = await loadoutTarget(player, id);
  if (!tgt) return { type: 'emote', message: 'No aircraft of yours here to re-rig. Board or park one at a field first.' };
  if ((tgt.live?.row || tgt.row)?.airborne) return { type: 'emote', message: 'Weight & balance is a ground job — land and shut down first.' };
  if (!fieldOf(player)) return { type: 'emote', message: "Re-rigging the cabin needs a hangar's tools — do it at a field." };
  if (!isConfigurable(tgt.type)) return { type: 'emote', message: `The ${tgt.type.name} has a fixed cabin — nothing to trade between seats and cargo.` };

  const budget = loadoutBudget(tgt.type), maxSeats = Math.max(1, Math.floor(budget / SEAT_KG));
  const cur = effLoadout(tgt.row, tgt.type);
  const loaded = tgt.row.custom_data?.cargoWeight || 0;
  const sub = (a[0] || '').toLowerCase();

  const line = (lbl, seats) => {
    const cargo = Math.max(0, budget - seats * SEAT_KG), on = seats === cur.seats;
    return `· <b>${lbl}</b> — <b>${seats}</b> seat${seats > 1 ? 's' : ''} (incl. pilot) + <b>${cargo}kg</b> hold${on ? ' <span class="text-green">◄ current</span>' : ` · <span class="action-link" data-action="cmd" data-cmd="loadout ${lbl.toLowerCase()}">rig</span>`}`;
  };
  if (!sub) {
    return { type: 'output', message:
      `<span class="text-cyan">WEIGHT &amp; BALANCE — ${tgt.type.name}:</span> one payload budget of <b>${budget}kg</b>, split how you like.\n` +
      `${line('Passenger', maxSeats)}\n${line('Combi', tgt.type.seats)}\n${line('Freight', 1)}\n` +
      `<span class="text-dim">Now: ${cur.seats} seats + ${cur.cargoCap}kg hold${loaded ? ` (${loaded}kg loaded)` : ''}. Also <b>loadout &lt;1..${maxSeats}&gt;</b> for an exact seat count.</span>` };
  }

  let seats;
  if (sub === 'passenger' || sub === 'pax') seats = maxSeats;
  else if (sub === 'combi') seats = tgt.type.seats;
  else if (sub === 'freight' || sub === 'cargo') seats = 1;
  else { const n = parseInt(sub, 10); if (!Number.isFinite(n)) return { type: 'emote', message: `Rig her how? <b>loadout passenger|combi|freight</b> or <b>loadout &lt;1..${maxSeats}&gt;</b>.` }; seats = Math.max(1, Math.min(maxSeats, n)); }
  const cargoCap = Math.max(0, budget - seats * SEAT_KG);
  if (loaded > cargoCap) return { type: 'emote', message: `You've ${loaded}kg in the hold — that rig only takes ${cargoCap}kg. <b>jettison</b> or deliver the load first.` };

  const cd = tgt.live ? (tgt.live.row.custom_data || {}) : (tgt.row.custom_data || {});
  cd.loadout = { seats, cargoCap };
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), tgt.id]);
  if (tgt.live) tgt.live.row.custom_data = cd; else tgt.row.custom_data = cd;
  return { type: 'output', message: `<span class="item-grant">Cabin re-rigged: <b>${seats}</b> seat${seats > 1 ? 's' : ''} + <b>${cargoCap}kg</b> of hold. The ${tgt.type.name} is set up for ${seats <= 1 ? 'pure freight' : cargoCap === 0 ? 'a full cabin' : 'a mixed load'}.</span>` };
}

// ── Sell / cancel rental — Tablet OS "Vehicles" app ─────────────────────────
// Deliberately ID-based rather than location-gated like the rest of this file:
// the whole point of managing your fleet from the tablet is not having to trek
// to wherever a craft happens to be parked. Both are called directly by
// plugins/tablet/vehicles-app.js (player, aircraftId) — not chat commands.

// Outright sale of an owned (non-rental) aircraft: deletes the instance for a
// refund. Half of buy price, discounted further by hull damage — more generous
// than cmdSalvage's wreck-scrap payout (~5% of price_buy) since this one still
// flies; a write-off should be insured or salvaged, not sold (wrecks are
// excluded below, and the tablet's own aircraft list already filters them out).
// Drops any insurance policy on her too — nothing left to insure.
export async function sellAircraft(player, aircraftId) {
  const { rows } = await query(
    `SELECT a.id, a.owner_id, a.rental, a.is_wreck, a.damage, a.airborne, t.price_buy, t.name tname
     FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1`, [aircraftId]);
  const ac = rows[0];
  if (!ac) return { type: 'error', message: 'No such aircraft.' };
  if (ac.owner_id !== player.id || ac.rental) return { type: 'error', message: 'You can only sell an aircraft you own outright.' };
  if (ac.is_wreck) return { type: 'error', message: 'Nothing to sell — salvage a wreck instead.' };
  // A "live" (currently loaded) aircraft's in-memory row is the source of truth
  // for airborne/damage — the DB column only gets flushed by persist() on its own
  // schedule, so checking it directly can see a stale airborne=1 for a plane
  // that already landed (same reason requireOwned above checks tgt.live?.row,
  // not a fresh SELECT).
  const live = liveAircraft.get(aircraftId);
  const airborne = live ? !!live.row.airborne : !!ac.airborne;
  const damage = live ? live.row.damage : ac.damage;
  if (airborne) return { type: 'error', message: "Land her first — can't sell an aircraft in the air." };
  if (live?.occupants?.size) return { type: 'error', message: 'Clear everyone out of her first.' };

  const value = Math.max(1, Math.round((ac.price_buy || 0) * 0.5 * (1 - (damage || 0) * 0.5)));
  if (live) liveAircraft.delete(aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [aircraftId]);
  await query('DELETE FROM insurance_policies WHERE aircraft_id=$1', [aircraftId]);
  player.credits = (player.credits || 0) + value;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  return { type: 'output', message: `<span class="item-grant">Sold the ${clean(ac.tname)} for ${value}₵.</span>`, player_update: { credits: player.credits } };
}

// Hand back a rental outright: deletes the instance. No refund — the flat desk
// fee already bought the use you got out of it (matches the rental desk's own
// "just bring her back" framing; this is the remote version of that walk).
export async function cancelRental(player, aircraftId) {
  const { rows } = await query(
    `SELECT a.id, a.owner_id, a.rental, a.airborne, t.name tname
     FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1`, [aircraftId]);
  const ac = rows[0];
  if (!ac) return { type: 'error', message: 'No such aircraft.' };
  if (ac.owner_id !== player.id || !ac.rental) return { type: 'error', message: "That's not a rental of yours." };
  // See sellAircraft's comment — check the live in-memory row, not the DB
  // column, which only gets flushed by persist() on its own schedule.
  const live = liveAircraft.get(aircraftId);
  const airborne = live ? !!live.row.airborne : !!ac.airborne;
  if (airborne) return { type: 'error', message: "Land her first — can't return a rental in the air." };
  if (live?.occupants?.size) return { type: 'error', message: 'Clear everyone out of her first.' };

  if (live) liveAircraft.delete(aircraftId);
  await query('DELETE FROM aircraft WHERE id=$1', [aircraftId]);
  return { type: 'output', message: `<span class="item-grant">Returned the ${clean(ac.tname)} — the rental slot is free.</span>` };
}

// Flush stuck airborne aircraft — Tablet OS "Vehicles" app. Recovery for a craft
// left flagged airborne with nobody driving it: a crashed tab / lost connection
// (or a server restart) can strand a plane at airborne=1, which blocks selling
// and reads as "Airborne" forever until the 10-minute unattended auto-return in
// index.js fires. Grounds every OWNED aircraft of the player's that's aloft with
// no one aboard — a still-loaded instance is parked by the hangar crew (parkAt
// disembarks + persists), a DB-only ghost just has its flag cleared in place.
// A craft someone is genuinely flying (occupants aboard) is left alone. Returns
// the count grounded. Rentals are included: a rental stranded airborne is
// unsellable AND un-returnable (cancelRental refuses her aloft) with no other
// recovery path, so flush must ground her too — once down, the tablet's per-
// vehicle Cancel Rental button reappears and clears her normally.
export async function flushAirborne(player) {
  const { rows } = await query(
    // takeoff_mode joined in: an OFFLINE row (no live instance) still has to know whether a
    // helipad is a legal place to tow it to, and the aircraft row alone can't say.
    `SELECT a.id, a.airborne, a.parked_zone_id, a.grid_x, a.grid_y, t.takeoff_mode
     FROM aircraft a JOIN aircraft_types t ON t.id = a.type_id
     WHERE a.owner_id=$1 AND a.is_wreck=0`, [player.id]);
  let grounded = 0;
  for (const ac of rows) {
    const live = liveAircraft.get(ac.id);
    if (live) {
      // Recover a craft stranded "aboard" by a mid-flight refresh: a disconnect (or a
      // reconnect that re-seats the pilot) leaves the owner in her occupant set, so she reads
      // as "someone's flying her" forever and blocks flush + sell. Prune ghost occupants
      // (disconnected) and detach the REQUESTING owner — invoking flush from the tablet IS them
      // climbing out of their own plane. Only a DIFFERENT live player genuinely riding blocks it.
      let realRider = false, recovered = false;
      for (const pid of [...live.occupants]) {
        const p = getLivePlayer(pid);
        if (!p) { live.occupants.delete(pid); recovered = true; }            // ghost — gone
        else if (pid === player.id) { detach(p); live.occupants.delete(pid); recovered = true; }   // it's you — climb out
        else realRider = true;                                              // a real passenger — leave her be
      }
      if (realRider) continue;
      if (live.row.airborne) {
        const home = (live.homeField && getZone(live.homeField)?.flags?.airfield_id) ? live.homeField : null;
        const dest = home || nearestAirfield(live.row.grid_x, live.row.grid_y, { needsRunway: !craftIsVtol(live) })?.id || live.row.parked_zone_id;
        if (dest) { await parkAt(live, dest); recovered = true; }           // set her down
      }
      if (recovered) grounded++;
    } else if (ac.airborne) {
      const dest = ac.parked_zone_id || nearestAirfield(ac.grid_x, ac.grid_y, { needsRunway: ac.takeoff_mode !== 'vtol' })?.id || null;
      await query(
        `UPDATE aircraft SET airborne=0, altitude_band='ground', throttle=0${dest ? ', parked_zone_id=$2' : ''} WHERE id=$1`,
        dest ? [ac.id, dest] : [ac.id]);
      grounded++;
    }
  }
  return grounded;
}

// `sell <id>` (hangar-bay panel) / `cancelrental <id>` — the chat-command
// wrappers around sellAircraft/cancelRental for the hangar-bay UI, which
// (unlike the tablet) refreshes the whole floor rather than round-tripping a
// screen payload. `sell` is claimed only when the leading token is a real
// aircraft id (popCraftId); anything else is ordinary item-selling → commerce.
// Resolve an aircraft the player OWNS from what they typed: an internal id (what
// the panel's buttons pass) or the tail name they actually call her by. The tail
// is the whole point — an id is not a thing a player can see, let alone type, so
// before this these two verbs were reachable only by clicking. Ambiguity is
// reported rather than guessed at: selling is not reversible.
async function ownedCraftByName(player, words, { rentalsOnly = false } = {}) {
  const q = words.join(' ').trim().toLowerCase();
  if (!q) return { error: null };                    // no argument — caller decides
  const { rows } = await query(
    `SELECT a.id, a.name, a.rental, t.name AS type_name
       FROM aircraft a JOIN aircraft_types t ON t.id = a.type_id
      WHERE a.owner_id=$1 AND a.is_wreck=0 ${rentalsOnly ? 'AND a.rental=1' : ''}`,
    [player.id]
  );
  const norm = r => String(r.name || r.type_name || '').toLowerCase();
  const hits = rows.filter(r => norm(r) === q)
    .concat(rows.filter(r => norm(r) !== q && norm(r).startsWith(q)));
  if (!hits.length) return { error: `You have no ${rentalsOnly ? 'rental' : 'aircraft'} called "${words.join(' ')}".` };
  if (hits.length > 1) return { error: `Which one? ${hits.map(r => `<b>${clean(r.name || r.type_name)}</b>`).join(', ')}` };
  return { id: hits[0].id, name: hits[0].name || hits[0].type_name };
}

async function cmdSell(args, raw, player, broadcast) {
  let { id, rest } = popCraftId(args);
  if (!id && rest.length) {
    // Not an id — it may still be a tail name. Only if it resolves to one of the
    // player's own aircraft do we claim the verb; anything else is commerce's
    // item-sell, which is what `sell` means to almost everybody.
    const byName = await ownedCraftByName(player, rest);
    if (byName.id) id = byName.id;
  }
  if (!id) return commerceCommands.sell(args, raw, player, broadcast);
  const res = await sellAircraft(player, id);
  out(player.id, res.message);
  if (res.player_update) sendToPlayer(player.id, { type: 'player_update', ...res.player_update });
  return pushHangarBay(player);
}

async function cmdCancelRental(args, raw, player) {
  let { id, rest } = popCraftId(args);
  if (!id && rest.length) {
    const byName = await ownedCraftByName(player, rest, { rentalsOnly: true });
    if (byName.error) return { type: 'error', message: byName.error };
    id = byName.id;
  }
  if (!id) {
    const { rows } = await query(
      `SELECT a.name, t.name AS type_name FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id
        WHERE a.owner_id=$1 AND a.rental=1 AND a.is_wreck=0`, [player.id]);
    if (!rows.length) return { type: 'error', message: 'You have no rentals to cancel.' };
    // Exactly one rental needs no disambiguation — asking "which one?" when there
    // is only one is the panel talking, not the game.
    if (rows.length === 1) {
      const only = await ownedCraftByName(player, [String(rows[0].name || rows[0].type_name)], { rentalsOnly: true });
      if (only.id) id = only.id;
    }
    if (!id) return { type: 'error', message: `Cancel which rental? ${rows.map(r => `<b>${clean(r.name || r.type_name)}</b>`).join(', ')}` };
  }
  const res = await cancelRental(player, id);
  out(player.id, res.message);
  return pushHangarBay(player);
}

// `flushairborne` — the ONLY way to recover a craft stuck showing "Airborne" with
// nobody aboard (a crashed tab, a lost connection, a server restart). Until now it
// existed solely as a button on the tablet's Vehicles app, which made a plane a
// player couldn't fly, sell or manage into a permanent loss for anyone who didn't
// use the tablet. It's an anti-stuck recovery, so it must be reachable by typing.
async function cmdFlushAirborne(args, raw, player) {
  const n = await flushAirborne(player);
  return {
    type: 'output',
    message: n
      ? `<span class="msg-system">Grounded ${n} aircraft that ${n === 1 ? 'was' : 'were'} stuck aloft.</span>`
      : 'No stranded aircraft to flush.',
  };
}

export const commands = {
  hangar: cmdHangar,
  showroom: cmdShowroom,
  fleet: cmdFleet,
  carousel: cmdFleet,
  view: cmdView,
  hangaract: cmdHangarAct,
  paintset: cmdPaintset,
  scheme: cmdScheme,
  repair: cmdRepair,
  salvage: cmdSalvage,
  rebuild: cmdRebuild,
  tune: cmdTune,
  tuneset: cmdTuneset,
  installkit: cmdInstallKit,
  modify: cmdModify,
  customize: cmdModify,
  loadout: cmdLoadout,
  sell: cmdSell,
  cancelrental: cmdCancelRental,
  flushairborne: cmdFlushAirborne,
  groundall: cmdFlushAirborne,
};
