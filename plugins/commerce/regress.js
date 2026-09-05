// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
import { vendorGrudgeRemaining, grudgeRefusal } from '../../server/engine/vendor-grudge.js';
import { isVendorClosed, hoursUntilOpen, openInPhrase, vendorClosedLine, isVendorOffHours, isVendorRole, vendorOffHoursLine } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRegisteredMoveGates, getRegisteredShutProviders, shutStatus } from '../../server/engine/movement-gates.js';
import { rowIsInstanced, NOT_INSTANCED_SQL } from '../../server/engine/inventory.js';
import { getCrimeStars } from '../../server/engine/crimes.js';
import { world, streetExitFrom, isStreetLanding, isEnterableFacade, getMinimapData } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { furnitureObjectType } from '../../server/engine/furniture-shop.js';
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default async function regress({ run, check, getPlayer }) {
  let r = await run('shop');
  check('shop verb routed', /Browse whose shop/.test(r?.message || ''), r?.message);

  r = await run('buy');
  check('buy verb routed', /Buy what/.test(r?.message || ''), r?.message);

  r = await run('sell');
  check('sell verb routed', /Sell what/.test(r?.message || ''), r?.message);

  r = await run('balance');
  check('balance verb routed', r?.type === 'balance' && /Carried:/.test(r?.message || ''), r?.message);

  // Vendor grudge: a player with no history reads clean (SELECT-only, safe on
  // the in-memory fake player), and the shared refusal is well-formed. The full
  // rob→refuse→lapse round-trip writes a persistent flag and is manual QA.
  const clean = await vendorGrudgeRemaining(getPlayer().id, 'npc_regress_no_grudge');
  check('no grudge by default', clean === 0, `remaining=${clean}`);
  const refusal = grudgeRefusal({ name: 'Testvendor' }, 3 * 24 * 60 * 60 * 1000);
  check('grudge refusal names the vendor + a cooldown', /Testvendor/.test(refusal) && /day/.test(refusal), refusal.slice(0, 80));

  // ── Shop hours ─────────────────────────────────────────────────────────────
  // Synthetic vendors keyed off the LIVE game clock, so the assertions hold at
  // any time of day (the world clock runs during regress).
  const env = getEnvironmentState();
  const today = DAY_KEYS[env.dayOfWeek % 7];
  const hour = env.hour ?? 0;

  const allDay = { name: 'Alltimes', vendor_schedule: { [today]: [{ from: 0, to: 24 }] } };
  check('a vendor scheduled all day reads open', !isVendorClosed(allDay));
  check('an unscheduled vendor never closes', !isVendorClosed({ name: 'Nohours' }));
  check('no schedule quotes no reopening time', hoursUntilOpen({ name: 'Nohours' }) === null && openInPhrase({ name: 'Nohours' }) === '');

  if (hour < 20) {
    const later = { name: 'Latevendor', vendor_schedule: { [today]: [{ from: hour + 2, to: hour + 3 }] } };
    check('a vendor whose block is still ahead reads closed', isVendorClosed(later));
    const h = hoursUntilOpen(later);
    check('hoursUntilOpen counts down to the next block', h > 1 && h <= 2, `h=${h}`);
    check('the closed line quotes the wait', /open again in about \d+ (hour|minute)/.test(vendorClosedLine(later)), vendorClosedLine(later));
  }

  // Presence: a commuting vendor opens when they WALK IN, not on the stroke of the
  // hour. Only vendors with a work_zone_id are gated this way.
  const onShift = { [today]: [{ from: 0, to: 24 }] };
  check('an on-shift vendor still walking to work reads closed',
    isVendorClosed({ name: 'Latecomer', work_zone_id: 'zone_shop', zone_id: 'zone_street', vendor_schedule: onShift }));
  check("the same vendor reads open once they're behind the counter",
    !isVendorClosed({ name: 'Latecomer', work_zone_id: 'zone_shop', zone_id: 'zone_shop', vendor_schedule: onShift }));
  check('an absent vendor doesn\'t quote next week\'s opening hour',
    /hasn't opened up yet/.test(vendorClosedLine({ name: 'Latecomer', work_zone_id: 'zone_shop', zone_id: 'zone_street', vendor_schedule: onShift })));
  check('a stallholder with no work_zone_id is unaffected by presence',
    !isVendorClosed({ name: 'Stallie', zone_id: 'zone_street', vendor_schedule: onShift }));

  // ── The 24-hour lie ────────────────────────────────────────────────────────
  // hoursUntilOpen only counted blocks that START in the future, so a shop whose
  // block was ALREADY RUNNING — shut purely because the shopkeeper hadn't walked
  // in — was quoted tomorrow's opening. At five past six that reads "opens again
  // in about 24 hours", and a player reported Two-Cell Supply as permanently shut
  // on the strength of it. `onShift` runs 00:00–24:00, so it is always in progress.
  check('a block already in progress counts as zero, not tomorrow',
    hoursUntilOpen({ name: 'Walker', vendor_schedule: onShift }) === 0,
    `h=${hoursUntilOpen({ name: 'Walker', vendor_schedule: onShift })}`);
  check('an on-the-clock vendor quotes no wait at all',
    openInPhrase({ name: 'Walker', vendor_schedule: onShift }) === '',
    openInPhrase({ name: 'Walker', vendor_schedule: onShift }));

  // Covert dealers keep their own window and are exempt from both.
  const covert = { name: 'Shade', flags: { covert: true }, vendor_schedule: { [today]: [{ from: 0, to: 0 }] } };
  check('covert dealers ignore vendor hours', !isVendorClosed(covert));

  // Dialogue gate: off-hours silences a SELLER's tree, but never an ordinary
  // employed NPC who merely carries a commute timetable.
  if (hour < 20) {
    const sched = { [today]: [{ from: hour + 2, to: hour + 3 }] };
    check('an off-hours vendor is off-hours regardless of where they stand',
      isVendorOffHours({ name: 'Shut', work_zone_id: 'zone_shop', zone_id: 'zone_shop', vendor_schedule: sched }));
    check('an absent but on-shift vendor is NOT off-hours',
      !isVendorOffHours({ name: 'Walker', work_zone_id: 'zone_shop', zone_id: 'zone_street', vendor_schedule: onShift }));
    check('the off-hours brush-off is face to face, not about the counter',
      /off the clock/.test(vendorOffHoursLine({ name: 'Shut', vendor_schedule: sched })));
    check('covert dealers are never off-hours', !isVendorOffHours(covert));
  }
  check('a seller with stock reads as a vendor role',
    isVendorRole({ name: 'Sells', vendor_inventory: [{ item_id: 'x' }] }));
  check('a seller with only a shop name reads as a vendor role',
    isVendorRole({ name: 'Sells', vendor_shop_name: 'Bodega Vu' }));
  check("an employed NPC with a timetable but no stock isn't a vendor role",
    !isVendorRole({ name: 'Clerk', vendor_schedule: onShift }));

  check('shop-hours move gate registered', getRegisteredMoveGates().includes('commerce:shop-hours'), getRegisteredMoveGates().join(','));

  // ── Telling them BEFORE the step ───────────────────────────────────────────
  // The gate above refuses the move; the shut provider is the same fact offered to
  // every surface that draws a way in (the room description's (closed) tag, the
  // dpad's red arrow, the minimap tile). The two must never disagree, so they read
  // one pair of predicates — these assert the provider obeys the gate's own rules.
  check('shop-hours shut provider registered',
    getRegisteredShutProviders().includes('commerce:shop-hours'), getRegisteredShutProviders().join(','));

  const shutPlayer = getPlayer();
  check('a null destination is never shut', shutStatus(shutPlayer, null) === null);

  // Whatever the clock happens to say, everything the provider calls shut must be a
  // shop room with every one of its vendors closed — and nothing else may be. This
  // is the gate's rule restated over the live world, so it holds at any hour.
  const shutZones = [], wrongShut = [], missedShut = [];
  for (const zone of world.zones.values()) {
    const isShut = !!shutStatus(shutPlayer, zone)?.shut;
    const vendors = [...world.npcs.values()].filter(n =>
      n?.work_zone_id === zone.id && !n.flags?.covert && n.vendor_inventory?.length &&
      n.vendor_schedule && Object.keys(n.vendor_schedule).length);
    const shouldBeShut = !!zone.flags?.is_interior && vendors.length > 0 && vendors.every(isVendorClosed);
    if (isShut) shutZones.push(zone.id);
    if (isShut && !shouldBeShut) wrongShut.push(zone.id);
    if (!isShut && shouldBeShut) missedShut.push(zone.id);
  }
  check("nothing is called shut that the hours don't shut", !wrongShut.length, wrongShut.slice(0, 5).join(','));
  // The fake player owns no apartment, so the resident exemption can never fire here
  // and every shut shop room must be reported.
  check('every shut shop room is reported shut', !missedShut.length, missedShut.slice(0, 5).join(','));
  check('a street tile is never shut', !shutZones.some(id => !world.zones.get(id)?.flags?.is_interior));

  // And the minimap payload carries it, or the tile has nothing to paint red.
  // Re-read the status after building the payload: the world clock runs during
  // regress, and a shop that opened in between is not a failure.
  const shutSample = shutZones[0];
  if (shutSample) {
    const nodes = getMinimapData(shutSample, 1, shutPlayer);
    const node = nodes.find(n => n.id === shutSample);
    if (shutStatus(shutPlayer, world.zones.get(shutSample))?.shut) {
      check('the minimap node of a shut room carries shut', node?.shut === true, `${shutSample} → ${JSON.stringify(node?.shut)}`);
    }
  }

  // ── Self-service checkout ──────────────────────────────────────────────────
  // Verb routing only; the fake player carries nothing marked unpaid, so this
  // exercises the empty-basket branch (the full pull→checkout→walk-out round trip
  // writes real inventory rows and is manual QA).
  r = await run('checkout');
  check('checkout verb routed', /nothing to pay for/i.test(r?.message || ''), r?.message);

  // The unpaid mark has to be instance-keyed both ways, or an unpaid steak merges
  // into a paid one on the way to the door and launders itself clean.
  check('unpaid is an instance key (JS)', rowIsInstanced({ custom_data: { unpaid: 'npc_x' } }));
  check('unpaid is an instance key (SQL)', NOT_INSTANCED_SQL.includes("'unpaid'"), NOT_INSTANCED_SQL);

  check('shoplifting is a chargeable crime', getCrimeStars('shoplifting') > 0, String(getCrimeStars('shoplifting')));
  // Deliberate, because the door asks you first and you answered it — well clear
  // of the 1-star slip it was when walking out was silent.
  check('shoplifting is charged as a deliberate act', getCrimeStars('shoplifting') >= 3, String(getCrimeStars('shoplifting')));

  // ── The door prompt ────────────────────────────────────────────────────────
  check('unpaid-door move gate registered', getRegisteredMoveGates().includes('commerce:unpaid-door'), getRegisteredMoveGates().join(','));

  // Unarmed, yes/no say so rather than moving anybody: a stray `no` in chat must
  // never walk the player out of a room.
  r = await run('yes');
  check('yes with nothing pending is refused', r?.type === 'error' && /waiting on an answer/i.test(r?.message || ''), r?.message);
  r = await run('no');
  check('no with nothing pending is refused', r?.type === 'error' && /waiting on an answer/i.test(r?.message || ''), r?.message);

  // Arming is idempotent per door — the second ask is the ANSWER, which is what
  // makes "warn once" one warning rather than a wall. Cleared, it arms again.
  const armed = await dispatchAction({ type: 'commerce.arm_door_prompt', actor: getPlayer(), params: { owner: 'npc_regress_shop', direction: 'north' } });
  check('the door prompt arms', armed?.armed === true, JSON.stringify(armed));
  const again = await dispatchAction({ type: 'commerce.arm_door_prompt', actor: getPlayer(), params: { owner: 'npc_regress_shop', direction: 'north' } });
  check("the same door doesn't ask twice", again?.armed === false, JSON.stringify(again));
  const other = await dispatchAction({ type: 'commerce.arm_door_prompt', actor: getPlayer(), params: { owner: 'npc_regress_other_shop', direction: 'north' } });
  check('a different shop asks for itself', other?.armed === true, JSON.stringify(other));
  await dispatchAction({ type: 'commerce.clear_door_prompt', actor: getPlayer(), params: {} });
  r = await run('yes');
  check('a cleared prompt answers to nothing', r?.type === 'error', r?.message);

  // ── Self-service stock: the shop floor and the room behind it ───────────────
  // A `vendor_stock` case is filled by exactly ONE mechanic — the owning vendor's
  // sourced catalogue entries (`sourceContainer` + `restockToQty`), delivered by
  // restockSourcedContainers. Four ways that has silently broken, each asserted
  // over the LIVE world because each is a content shape rather than a code path,
  // and each failed QUIETLY: the case just reads empty (or free) and looks like
  // the feature was never built.
  // ── Bought appliances actually work ────────────────────────────────────────
  // A furniture ITEM is a template for a furniture ROW, and only `flags` makes
  // that crossing — `placeFurniture` copies `item.flags` and nothing else. Every
  // appliance below once carried its functional key in `tags` alone, so the
  // authored copy of an appliance worked and the copy you PAID for was an inert
  // prop. It failed silently and in the player's favour-costing direction: the
  // shop takes the money, the piece arrives, and it simply never does its job.
  {
    const { rows: appliances } = await query(
      `SELECT id, name, tags, flags FROM items WHERE type = 'furniture'`);
    // Keys the engine reads off the placed ROW's flags. If an item advertises one
    // in `tags` (which drives the shop shelf) it must also carry it in `flags`.
    for (const key of ['stove_tier', 'preserves', 'container', 'microwave', 'brew_tier']) {
      for (const it of appliances) {
        if (it.tags?.[key] === undefined) continue;
        check(`${it.id}: ${key} reaches the placed row`,
          it.flags?.[key] !== undefined, `tags.${key}=${JSON.stringify(it.tags[key])} flags.${key}=undefined`);
      }
    }
    // …and a piece that holds things is born a container, or `stow`/`open` — which
    // find furniture containers by object_type and nothing else — never see it.
    for (const it of appliances) {
      if (!(Number(it.flags?.container) > 0)) continue;
      check(`${it.id}: placed as a container row`,
        furnitureObjectType(it.flags) === 'container', furnitureObjectType(it.flags));
    }
    check('non-holding furniture stays plain furniture',
      furnitureObjectType({ interactions: ['sit'] }) === 'furniture'
      && furnitureObjectType({ container: 0 }) === 'furniture', 'sentinel');
  }

  {
    const { rows: cases } = await query(
      `SELECT id, flags FROM furniture WHERE jsonb_exists(flags, 'vendor_stock')`);
    check('at least one self-service case is authored', cases.length > 0, String(cases.length));

    const { rows: boxes } = await query(
      `SELECT id, flags FROM furniture WHERE object_type = 'container'`);
    const boxById = new Map(boxes.map(b => [b.id, b.flags || {}]));
    const capOf = id => boxById.get(id)?.container ?? 60000;

    for (const c of cases) {
      const vendor = world.npcs.get(c.flags.vendor_stock);
      check(`${c.id} names a live vendor`, !!vendor, String(c.flags.vendor_stock));
      if (!vendor) continue;

      // `restock_items` is the consort BOTTOMLESS dispenser — it re-mints one of
      // every listed item on each container view. On a `vendor_stock` case that is
      // a second, infinite source of truth for the same box: it hands out free
      // goods forever and inflates the `stock` count the shelf reads.
      check(`${c.id} isn't also a bottomless dispenser`, !c.flags.restock_items,
        `carries restock_items (${(c.flags.restock_items || []).length} ids) AND vendor_stock`);

      const sourced = (vendor.vendor_inventory || []).filter(e => e.sourceContainer === c.id && e.restockToQty > 0);
      check(`${c.id} is sourced by ${vendor.id}'s catalogue`, sourced.length > 0,
        'nothing in the catalogue names it — the case can never be stocked');
      if (!sourced.length) continue;

      // The cap is applied per entry in catalogue order, so an over-subscribed
      // case starves whatever is authored LAST — those items read `stock: 0` on
      // the shelf forever, which reads as a missing item rather than a small box.
      let floorG = 0;
      for (const e of sourced) floorG += (getItem(e.item_id)?.weight || 0) * e.restockToQty;
      check(`${c.id} can hold a full delivery`, floorG <= capOf(c.id),
        `needs ${(floorG / 1000).toFixed(1)}kg, holds ${(capOf(c.id) / 1000).toFixed(1)}kg`);

      // The stockroom the case draws from, and the reserve depth kept behind it.
      const back = c.flags.backstock;
      if (!back) continue;
      check(`${c.id} backstocks from a real container`, boxById.has(back), String(back));
      if (!boxById.has(back)) continue;
      const depth = Math.max(0, Number(boxById.get(back).backstock_depth ?? 2));
      check(`${back} can hold ${depth}x reserve for ${c.id}`, floorG * depth <= capOf(back),
        `needs ${(floorG * depth / 1000).toFixed(1)}kg, holds ${(capOf(back) / 1000).toFixed(1)}kg`);
    }
  }

  // ── Vendor purchase remarks ────────────────────────────────────────────────
  // The wiring is generic, so what can actually break is the AUTHORING: a remark
  // keyed to an item the vendor doesn't stock (or that doesn't exist) is silently
  // dead content — the listener just never fires and nobody finds out. Sweep
  // every vendor in the world rather than naming one, so this holds for whatever
  // gets authored next.
  let remarkCount = 0;
  for (const npc of world.npcs.values()) {
    const remarks = npc.flags?.purchase_remarks;
    if (!remarks || typeof remarks !== 'object') continue;
    const stocked = new Set((npc.vendor_inventory || []).map(r => r.item_id));
    for (const [itemId, remark] of Object.entries(remarks)) {
      remarkCount++;
      check(`purchase remark on ${npc.id} targets a real item (${itemId})`, !!getItem(itemId));
      check(`purchase remark on ${npc.id} targets an item they SELL (${itemId})`, stocked.has(itemId),
        `stocks: ${[...stocked].join(',') || 'nothing'}`);
      const text = typeof remark === 'string' ? remark : remark?.text;
      check(`purchase remark on ${npc.id} has text (${itemId})`, !!text && text.length > 10);
    }
  }
  check('at least one vendor purchase remark is authored', remarkCount > 0, String(remarkCount));

  // ── Being put out lands you on the STREET ───────────────────────────────────
  // Closing time and the club bouncer both eject through streetExitFrom, and the one
  // destination that must never be chosen is a FACADE tile: `resolveLanding` forwards
  // a landing on a facade into that building's interior, so an eject onto one puts
  // the player inside the shop next door instead of on the pavement. Water is out for
  // the same class of reason (an ejection is not a drowning).
  //
  // Asserted as an invariant over the LIVE world rather than a fixture, because the
  // failure mode is a content shape — one shop whose only exit is a facade — and a
  // hand-built fixture would never contain the case that breaks it.
  {
    const interiors = [...world.zones.values()].filter(z => z.flags?.is_interior).slice(0, 400);
    let checked = 0;
    let bad = null;
    for (const z of interiors) {
      const dest = streetExitFrom(z.id);
      if (!dest) continue;              // sealed room — the caller leaves them put
      checked++;
      if (!isStreetLanding(dest)) { bad = `${z.id} → ${dest}`; break; }
    }
    check('every interior that can eject ejects onto standable street', !bad, bad || `${checked} rooms`);
    check('the eject search actually found streets (not vacuously true)', checked > 0, String(checked));
    // A facade is never a landing, and the predicate is what every ejector shares.
    const facade = [...world.zones.values()].find(z => isEnterableFacade(z));
    if (facade) check('a facade is never a valid eject landing', isStreetLanding(facade.id) === false, facade.id);
  }
}
