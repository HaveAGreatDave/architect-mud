// Furnishing regression suite, run by tests/regress.js (never loaded in
// production). Covers place/take gating and the round trip, the room cap,
// boxing on release, and the buy-side carry choice. Every row it makes uses a
// throwaway zone or player id and is removed in the finally.
import { query } from '../../server/models/db.js';
import { on, off } from '../../server/engine/events.js';
import { world, setApartmentCache, getZoneFurniture, insertFurniture, deleteFurnitureWhere } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { giveItemById, spawnInContainer } from '../../server/engine/inventory.js';
import { releaseApartment } from '../../server/engine/apartments.js';
import { placeFurnitureFromItem, buyFurniture } from '../../server/engine/furniture-shop.js';
import { boxPlacedFurniture, MAX_PIECES_PER_ROOM } from './index.js';

const STOOL = 'item_furn_barstool_wreck';   // 3 kg, sit
const SOFA = 'item_furn_busted_sofa';       // 20 kg, sit/lie
const FRIDGE = 'item_furn_fridge_coldbox';  // 22 kg, a container

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const APT = '__furnishing_test_apt__';
  const OWNER2 = 'furnish_owner_' + process.pid;
  const AUTHORED = 'furn_furnishing_regress_lamp';
  const savedZone = p.current_zone;
  const savedPosture = p.posture, savedSittingOn = p.sittingOn;

  const stool = getItem(STOOL), sofa = getItem(SOFA), fridge = getItem(FRIDGE);
  check('test furniture items exist', !!(stool && sofa && fridge));
  if (!stool || !sofa || !fridge) return;

  const invCount = async (owner, itemId) => {
    const { rows } = await query(
      'SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL',
      [owner, itemId]);
    return rows[0].n;
  };
  const piecesHere = () => getZoneFurniture(APT).filter(f => f.origin === 'player');
  const freshWeight = () => { delete p._carriedWeight; };

  world.zones.set(APT, { id: APT, name: 'Furnishing Test Flat', flags: { is_apartment: true }, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
  setApartmentCache(APT, { zone_id: APT, owner_id: p.id, owner_type: 'player' });

  try {
    // ── place: gating ────────────────────────────────────────────────────────
    await giveItemById(p.id, STOOL, 1);
    freshWeight();
    let r = await run('place wobbly barstool');
    check('place outside a room you control is refused', /isn't your place/i.test(r?.message || ''), r?.message);
    r = await run('place unicorn');
    check('place of something not carried says so', /aren't carrying any furniture called/i.test(r?.message || ''), r?.message);

    // ── place → take round trip ──────────────────────────────────────────────
    // In the room's player set too, as a real move would leave it: the in-use
    // check reads who is in the room, not who thinks they are.
    p.current_zone = APT;
    world.zones.get(APT).players.add(p.id);
    const before = await invCount(p.id, STOOL);
    r = await run('place barstool');
    check('place sets the piece down', /set the wobbly barstool down/i.test(r?.message || ''), r?.message);
    let piece = piecesHere().find(f => f.name === stool.name);
    check('placed piece is a player row with its item id', piece?.origin === 'player' && piece?.owner_id === p.id && piece?.flags?.item_id === STOOL, JSON.stringify(piece));
    check('placed piece id is furn_<8hex>, which the content pipeline skips', /^furn_[0-9a-f]{8}$/.test(piece?.id || ''), piece?.id);
    check('place used up the carried item', await invCount(p.id, STOOL) === before - 1);

    p.posture = 'sitting'; p.sittingOn = stool.name;
    r = await run('take barstool');
    check('take refuses a piece someone is sitting on', /using the wobbly barstool/i.test(r?.message || ''), r?.message);
    p.posture = savedPosture; p.sittingOn = savedSittingOn;

    freshWeight();
    r = await run('take barstool');
    check('take picks the piece back up', /pick up the wobbly barstool/i.test(r?.message || ''), r?.message);
    check('take removed the furniture row', !piecesHere().some(f => f.id === piece.id));
    check('take returned the item', await invCount(p.id, STOOL) === before);

    // ── take: falls through for anything that isn't yours ────────────────────
    await insertFurniture({ id: AUTHORED, zone_id: APT, name: 'regress lamp', description: 'A test lamp.', object_type: 'furniture', flags: '{}' });
    r = await run('take regress lamp');
    check('take of an authored piece falls through to the engine', !/pick up the regress lamp/i.test(r?.message || '') && getZoneFurniture(APT).some(f => f.id === AUTHORED), r?.message);

    // ── take: too heavy ──────────────────────────────────────────────────────
    await placeFurnitureFromItem(sofa, APT, p.id);
    freshWeight();
    r = await run('take busted sofa');
    check('take refuses a piece too heavy to carry', /weighs 20kg/i.test(r?.message || ''), r?.message);

    // ── place: the room cap ──────────────────────────────────────────────────
    while (piecesHere().length < MAX_PIECES_PER_ROOM) await placeFurnitureFromItem(stool, APT, p.id);
    r = await run('place barstool');
    check('place refuses past the room cap', /no room for the wobbly barstool/i.test(r?.message || ''), r?.message);

    // ── buy: carry is offered only when it fits ──────────────────────────────
    const npc = { id: null, name: 'Test Vendor', flags: { covert: true } };
    freshWeight();
    r = await buyFurniture(p, npc, stool, { price: 5 });
    check('a light piece offers carry beside delivery', /Carry it out yourself/.test(r?.message || ''), r?.message);
    freshWeight();
    r = await buyFurniture(p, npc, sofa, { price: 5 });
    check('a heavy piece with one flat goes straight to delivery', !/Carry it out yourself/.test(r?.message || '') && /afford/i.test(r?.message || ''), r?.message);
    setApartmentCache(APT, { zone_id: APT, owner_id: 'nobody_' + process.pid, owner_type: 'player' });
    freshWeight();
    r = await buyFurniture(p, npc, sofa, { price: 5 });
    check('no flat and too heavy: the vendor refuses', /can't carry that/i.test(r?.message || ''), r?.message);
    setApartmentCache(APT, { zone_id: APT, owner_id: p.id, owner_type: 'player' });

    // ── boxing on release ────────────────────────────────────────────────────
    await query(`INSERT INTO players (id, username, password_hash, handle) VALUES ($1,$1,'x',$1) ON CONFLICT (id) DO NOTHING`, [OWNER2]);
    await placeFurnitureFromItem(sofa, APT, OWNER2);
    const box = await placeFurnitureFromItem(fridge, APT, OWNER2);
    await spawnInContainer(STOOL, box, 1);
    const res = await boxPlacedFurniture(APT);
    check('boxing clears every player piece from the room', piecesHere().length === 0, JSON.stringify(piecesHere().map(f => f.name)));
    check('boxing leaves authored furniture alone', getZoneFurniture(APT).some(f => f.id === AUTHORED));
    check('boxed pieces go back to their placer', await invCount(OWNER2, SOFA) === 1 && await invCount(OWNER2, FRIDGE) === 1, JSON.stringify(res));
    check('what was stored inside comes back loose', await invCount(OWNER2, STOOL) === 1);
    check('pieces of a placer with no player row are dropped, not boxed', res.dropped >= 1 && !res.boxed.some(b => b.ownerId === p.id), JSON.stringify(res));

    let seen = null;
    const listen = e => { if (e.zoneId === APT) seen = e; };
    on('property.released', listen);
    await releaseApartment({ zone_id: APT, owner_id: p.id, owner_type: 'player' }, APT);
    off('property.released', listen);
    check('releaseApartment emits property.released with the old owner', seen?.ownerId === p.id && seen?.kind === 'apartment', JSON.stringify(seen));
  } finally {
    p.current_zone = savedZone;
    p.posture = savedPosture; p.sittingOn = savedSittingOn;
    delete p._carriedWeight;
    await deleteFurnitureWhere('DELETE FROM furniture WHERE zone_id=$1', [APT]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id = ANY($1) AND item_id = ANY($2)', [[p.id, OWNER2], [STOOL, SOFA, FRIDGE]]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [OWNER2]).catch(() => {});
    world.apartments.delete(APT);
    world.zones.delete(APT);
  }
}
