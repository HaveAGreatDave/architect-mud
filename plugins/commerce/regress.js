// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
import { vendorGrudgeRemaining, grudgeRefusal } from '../../server/engine/vendor-grudge.js';
import { isVendorClosed, hoursUntilOpen, openInPhrase, vendorClosedLine, isVendorOffHours, isVendorRole, vendorOffHoursLine, anotherVendorOnDuty } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRegisteredMoveGates, getRegisteredShutProviders, shutStatus } from '../../server/engine/movement-gates.js';
import { rowIsInstanced, NOT_INSTANCED_SQL } from '../../server/engine/inventory.js';
import { getCrimeStars } from '../../server/engine/crimes.js';
import { world, streetExitFrom, isStreetLanding, isEnterableFacade, getMinimapData } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { furnitureObjectType } from '../../server/engine/furniture-shop.js';
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { lockCanHack, lockNoun } from '../../server/engine/commands/doors.js';
import { getAllLockTypes } from '../../server/engine/locks.js';
import {
  tradingHours, tradingHoursLine, hoursNotice, describeDoorHook,
  shopEntranceDoor, shopEntranceLock, shopDoorDefeated, shopClosedFor, shopVendorsFor, _test as _shopdoorTest,
} from './shopdoor.js';

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

  // ── The shift handover ─────────────────────────────────────────────────────
  // A shop staffed around the clock is two vendors sharing one work_zone_id. The
  // door lockup in ai-behaviour is keyed on the DEPARTING npc, so the day clerk
  // going home would throw the lock on the night clerk already behind the
  // counter — a shop that says it just shut while still trading.
  const HANDOVER = 'zone_regress_handover';
  const priorZone = world.zones.get(HANDOVER);
  world.zones.set(HANDOVER, { id: HANDOVER, npcs: new Set(['npc_day', 'npc_night', 'npc_browser']) });
  world.npcs.set('npc_day',     { id: 'npc_day',     name: 'Day',     work_zone_id: HANDOVER });
  world.npcs.set('npc_night',   { id: 'npc_night',   name: 'Night',   work_zone_id: HANDOVER });
  world.npcs.set('npc_browser', { id: 'npc_browser', name: 'Browser', work_zone_id: null });
  try {
    check("the day clerk leaving doesn't lock up on the night clerk",
      anotherVendorOnDuty(HANDOVER, 'npc_day'));
    world.zones.get(HANDOVER).npcs.delete('npc_night');
    check('the last vendor out still locks up — a browsing customer is not staff',
      !anotherVendorOnDuty(HANDOVER, 'npc_day'));
    check('an unknown zone never blocks the lockup',
      !anotherVendorOnDuty('zone_regress_nowhere', 'npc_day'));
  } finally {
    if (priorZone) world.zones.set(HANDOVER, priorZone); else world.zones.delete(HANDOVER);
    for (const id of ['npc_day', 'npc_night', 'npc_browser']) world.npcs.delete(id);
  }

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

  // ── THE SHOP DOOR ──────────────────────────────────────────────────────────
  // The refusal above used to be the whole of closing time. These cover the lock
  // standing behind it — see plugins/commerce/shopdoor.js.

  // A lock says for itself whether it can be breached. This USED to be the string
  // `lock:hololock` written into the hack path, which left `canHack` on every other
  // lock type a field with no reader — `lock:shopshutter` has declared it since
  // storefront was written and could never actually be hacked.
  check('a registered canHack lock is hackable', lockCanHack({ type: 'lock:shoplock' }));
  check('the shutter finally reads its own canHack', lockCanHack({ type: 'lock:shopshutter' }));
  check('a lock that declares canHack:false is not', !lockCanHack({ type: 'lock:longwatch' }));
  check('a lock with no opinion is not hackable', !lockCanHack({ type: 'lock:privacylock' }));
  // The TAG beats the type's defaults, which is what lets one authored door differ.
  check('an authored canHack:false overrides the type default',
    !lockCanHack({ type: 'lock:hololock', canHack: false }));
  check('an unknown lock type is not hackable', !lockCanHack({ type: 'lock:nonesuch' }));
  check('a door with no lock at all is not hackable', !lockCanHack(null));
  check('a lock is called by its own noun', lockNoun({ type: 'lock:hololock' }) === 'hololock', lockNoun({ type: 'lock:hololock' }));
  check('an unnamed lock is just a lock', lockNoun({ type: 'lock:privacylock' }) === 'lock', lockNoun({ type: 'lock:privacylock' }));

  check('the shoplock type is registered',
    getAllLockTypes().some(t => t.name === 'shoplock' && t.tagType === 'lock:shoplock'),
    getAllLockTypes().map(t => t.name).join(','));

  // ── The trading-hours card ─────────────────────────────────────────────────
  // Derived from the vendor's own commute timetable, so a shop's posted hours can
  // never drift from the hours it keeps.
  {
    const weekday = { mon: [{ from: 9, to: 17 }], tue: [{ from: 9, to: 17 }], wed: [{ from: 9, to: 17 }],
                      thu: [{ from: 9, to: 17 }], fri: [{ from: 9, to: 17 }] };
    const rows = tradingHours(weekday);
    check('consecutive days with the same hours collapse into one range',
      rows.length === 2 && rows[0].label === 'MON to FRI' && rows[1].label === 'SAT to SUN',
      rows.map(r => `${r.label}=${r.hours}`).join(' | '));
    check('a day with no block reads CLOSED', rows[1].hours === 'CLOSED', rows[1].hours);
    check('hours are a 24h clock', rows[0].hours === '09:00 to 17:00', rows[0].hours);

    const allHours = Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d => [d, [{ from: 0, to: 24 }]]));
    check('a shop open every hour says so in words',
      tradingHoursLine({ vendor_schedule: allHours }) === 'open all hours',
      String(tradingHoursLine({ vendor_schedule: allHours })));
    check('a vendor with no timetable has no card at all',
      tradingHoursLine({}) === null && hoursNotice({}) === null);
    check('the card names itself as a card', /trading hours/.test(hoursNotice({ vendor_schedule: weekday }) || ''));
  }

  // ── Has somebody been through it? ──────────────────────────────────────────
  // No new state: a shop door is locked while the shop is shut, so an entrance
  // standing unlocked during closed hours is one that was beaten. The corollary is
  // the one that matters — a door with NO lock must never read as beaten, or the
  // 32 shops whose entrance carries no lock get a front door that stands open all
  // night.
  check('a zone with no street exit has no shop door', shopEntranceDoor({ id: 'z', flags: {} }) === null);

  // The live content invariant. A floor rather than a total, so adding a shop
  // never fails this and deleting the doors always does.
  {
    let locked = 0, selfLink = null;
    for (const door of world.doors.values()) {
      if (!door.tags?.['lock:shoplock']) continue;
      locked++;
      if (door.zone_id === door.target_zone) selfLink = door.id;
    }
    check('the city has shop doors fitted', locked >= 50, `${locked} shoplock doors`);
    check('no shop door stands on the step from a tile to itself', !selfLink, selfLink || 'none');
  }

  // ── The rule the whole thing turns on ──────────────────────────────────────
  // The sync acts on a CHANGE of trading state, never on the state itself. Assert
  // it against a real shop door: beat the lock, run the sync with nothing else
  // moved, and the door must still be open. Re-asserting "closed means locked"
  // every 30 seconds would re-lock a door the player hacked half a minute after
  // they beat it, which is the feature deleting itself.
  {
    const shop = [...world.zones.values()].find(z => shopVendorsFor(z.id).length && shopEntranceLock(z));
    if (!shop) {
      check('a shop with a fitted entrance lock exists to test against', false, 'none found');
    } else {
      const door = shopEntranceLock(shop);
      const saved = { lock_state: door.lock_state, is_open: door.is_open, inside: door._autoLockedInside };

      _shopdoorTest.workDoor(shop, true);
      check('closing time locks the shop door', door.lock_state === 'locked', String(door.lock_state));
      check('and names the shop floor as the inside, so nobody is sealed in',
        door._autoLockedInside === shop.id, String(door._autoLockedInside));
      check('a locked shop door is not yet defeated', shopDoorDefeated(shop) === false);

      // The hack lands.
      door.lock_state = 'unlocked';
      check('an unlocked entrance reads as defeated', shopDoorDefeated(shop) === true);

      // ...and a sync with the shop's trading state UNCHANGED must leave it alone.
      //
      // ⚠ The remembered state has to be whatever the sync is about to compute, or
      // this check is vacuous half the day: pinning it to `true` while the live
      // clock says the shop is open makes the sync see a transition, unlock the
      // door, and satisfy the assertion for the opposite reason.
      const shutNow = shopClosedFor(shop) !== null;
      _shopdoorTest.lastShut.set(shop.id, shutNow);
      _shopdoorTest.syncShopDoors();
      check('a sync with no change of trading state does not touch the door',
        door.lock_state === 'unlocked', `${door.lock_state} (shutNow=${shutNow})`);

      // A door off its hinges cannot be locked by anybody.
      const hp = door.hp;
      door.hp = 0;
      _shopdoorTest.workDoor(shop, true);
      check('a destroyed shop door is never re-locked', door.lock_state === 'unlocked', String(door.lock_state));
      check('a destroyed entrance still reads as defeated', shopDoorDefeated(shop) === true);
      door.hp = hp;

      Object.assign(door, { lock_state: saved.lock_state, is_open: saved.is_open, _autoLockedInside: saved.inside });
      _shopdoorTest.lastShut.delete(shop.id);
    }
  }

  // The card reaches `examine door` through the engine's gather hook, and reads the
  // same from the pavement or from inside after closing.
  {
    const shop = [...world.zones.values()].find(z => shopVendorsFor(z.id).length && shopEntranceLock(z));
    if (shop) {
      const door = shopEntranceLock(shop);
      const line = describeDoorHook(door);
      check('examining a shop door reads its trading hours', /trading hours/.test(line || ''), String(line).slice(0, 60));
    }
    check('examining an ordinary door adds nothing',
      describeDoorHook({ zone_id: 'zone_regress_nowhere', target_zone: null }) === null);
  }
}
