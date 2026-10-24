// THE PODRACER: two turbines on a binder towing a cockpit pod on two cables, over the Scarletwastes.
//
// Built to the powerboat's shape. The client steps podracer-model.js at frame rate and reports four
// times a second; this keeps the row (`podracers`) and checks the report against an envelope
// (seat.js). Live positions are RAM only, in `rigs`, which is also what `vehicle.contacts` publishes
// so other players see the racer. A restart puts every racer back where it was last parked.
//
// The depot is to the standard every vehicle's is (docs/reference/depot-shell.md): a room you walk
// into (the racer bay off the Deadleg's truck shed), a counter in the room pane that opens on arrival
// and is dealt again after anything that changes it, a card per racer that seats you, a bay overlay
// on the seat while the racer stands in the shed door, buying, hiring and servicing, and on the log
// rung the same verbs with no screen.
//
//   lot.js       buying, hiring, selling, servicing and listing, and the counter's payload
//   seat.js      climbing in, the telemetry, the bay overlay, parking and the wreck
//   texthelm.js  the same racer driven by `pod` orders on the text Display Mode rungs

import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { takeFreshVehicle } from '../../server/engine/fresh-vehicle.js';
import { buyRacer, hireRacer, returnRacer, sellRacer, serviceRow, listRacers, racerHere, isLot, stockLines,
  racerLine, myRacers, racerPanel, sweepHires, recoverRacer, paintRow, parkedCards, fitRow, fitMenu, lockedRacerHere, setRacerLocked } from './lot.js';
import { registerVehicleLock } from '../../server/engine/vehicle-access.js';
import { mountRacer, cmdPodSync, cmdPodEvent, dropSeat, bayLotAt, pushBay, svcState, recoverSeated, homeLot, noteRacerParked } from './seat.js';
import { PODRACER_TYPES, podracerPoseFrom, podracerLook, podracerLivery } from '../../client/game/js/panels/podracer-model.js';
import { cmdPod, textPodCtx } from './texthelm.js';

// Every racer under way, by player id: the last report the server accepted.
export const rigs = new Map();
// Which racer each player is sitting in, by player id.
export const seated = new Map();

const say = (message) => ({ type: 'output', message });
const dim = (t) => `<span class="text-dim">${t}</span>`;

// ── Who is out there ───────────────────────────────────────────────────────────
// The contact shape is airContact's, as the trucks and boats send it. `podracer` carries the
// turbines' pose and the cable and binder state, which the renderer needs to draw three bodies
// rather than one, as each turbine's offset from the pod (podracerPoseFrom).
function racerContactsNear(x, y, range = 26) {
  if (!rigs.size) return [];
  const out = [];
  for (const rig of rigs.values()) {
    if (!Number.isFinite(rig.x) || Math.hypot(rig.x - x, rig.y - y) > range) continue;
    const look = rig.look || (rig.look = podracerLook(rig.kit));
    out.push({
      id: 'pod_' + rig.playerId,
      cls: 'podracer',
      x: rig.x, y: rig.y, hdg: rig.heading || 0,
      ias: rig.speed || 0,
      alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: 0, pitch: 0, vs: 0,
      power: +(((rig.lever?.[0] || 0) + (rig.lever?.[1] || 0)) / 2).toFixed(2),
      hullPct: Math.round((rig.hull ?? 1) * 100),
      podracer: Number.isFinite(rig.ex)
        ? { ...podracerPoseFrom(rig.ex - rig.x, rig.ey - rig.y, rig.eh || 0, PODRACER_TYPES[rig.typeId] || PODRACER_TYPES.podracer, rig.cables || [true, true], rig.binder !== false),
          thr: +(((rig.lever?.[0] || 0) + (rig.lever?.[1] || 0)) / 2).toFixed(2), arc: look.arc, flame: look.flame, pipes: !!look.anim.kit_pipes }
        : null,
      reg: rig.name || 'racer',
      livery: podracerLivery(rig.livery, rig.kit),
      variant: rig.typeId || 'podracer',
      // The kit's bolt-on parts, as the mesh channels they draw on (podracer-model.js podracerLook).
      anim: look.anim,
    });
  }
  return out;
}

export const hooks = {
  'vehicle.contacts': (x, y, range) => racerContactsNear(x, y, range),
  // A truck depot's counter deals the racers kept in its shed as cards (lot.js parkedCards).
  'depot.parked': (player, zoneIds) => parkedCards(player, zoneIds),
};

// ── The counter ────────────────────────────────────────────────────────────────
//
// Pushed where a screen belongs: in a lot room, on the rungs that take panels. The log rung gets
// nothing pushed and reads the verbs' own prose instead (`prefersLoggedPanels` is true ONLY on the
// bottom rung, the marina's note on the sense of the test).
export async function pushDepot(player) {
  if (!player?.current_zone || !isLot(getZone(player.current_zone))) return false;
  if (seated.has(player.id)) return false;
  if (await prefersLoggedPanelsOrDefault(player)) return false;
  const gone = await sweepHires(player.id, seated.get(player.id) || null);
  if (gone.length) sendToPlayer(player.id, { type: 'emote', message: dim(`The yard has taken back ${gone.join(' and ')}: the hire ran out.`) });
  const panel = await racerPanel(player, player.current_zone, { seatedId: seated.get(player.id) || null });
  if (!panel) return false;
  // The racer just bought or hired, which the counter offers to seat you in (depot-shell readyHtml).
  sendToPlayer(player.id, { ...panel, fresh: takeFreshVehicle(player.id) });
  return true;
}

/**
 * After anything that changed the world, the screen is dealt again: the overlay if they are sitting
 * in the racer on the bay door, the counter if they are standing in the bay. Nothing that changes
 * the world may end in a bare reply.
 */
async function repush(player) {
  if (seated.has(player.id)) { if (svcState.has(player.id)) await pushBay(player).catch(() => {}); return; }
  await pushDepot(player).catch(() => {});
}
const andRepush = (fn) => async (player, ...a) => { const out = await fn(player, ...a); await repush(player); return out; };

// ── podracer ───────────────────────────────────────────────────────────────────
//   podracer                 climb into your racer here, or see the bay's stock and your racers
//   podracer take <id>       climb into that racer (the counter's card)
//   podracer buy [type]      buy one (in the bay)
//   podracer hire [type]     hire one for two hours (in the bay)
//   podracer return [id]     hand a hire back (in the bay)
//   podracer sell [id]       sell one parked in the bay back to the yard
//   podracer service [id]    repair and refuel, in the bay or sitting in it on the bay door
//   podracer list            what you own and where
async function cmdPodracer(args = [], raw, player, broadcast) {
  const sub = String(args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ');
  if (sub === 'buy') return andRepush(buyRacer)(player, rest);
  if (sub === 'hire' || sub === 'rent') return andRepush(hireRacer)(player, rest);
  if (sub === 'return' || sub === 'handback') return andRepush(returnRacer)(player, args[1] || null);
  if (sub === 'sell') return andRepush(sellRacer)(player, args[1] || null);
  if (sub === 'service' || sub === 'repair' || sub === 'fuel') return serviceCmd(player, args[1] || null);
  if (sub === 'paint' || sub === 'livery') return paintCmd(player, args.slice(1));
  if (sub === 'fit' || sub === 'tune' || sub === 'upgrade' || sub === 'kit') return fitCmd(player, args.slice(1));
  if (sub === 'recover' || sub === 'fetch' || sub === 'tow') {
    // Sitting in it: the flatbed takes you and the racer back to the bay. Standing in a bay: it fetches
    // one of yours from wherever it was left.
    if (seated.has(player.id)) return recoverSeated(player, broadcast);
    return andRepush((pl, id) => recoverRacer(pl, id, null))(player, args[1] || null);
  }
  if (sub === 'list') return listRacers(player);
  if (seated.has(player.id)) return say(dim('You are already strapped in.'));
  // Climbing in takes yours, or one somebody left unlocked on this tile (vehicle-access.js).
  if (sub === 'take' || sub === 'ride') {
    const row = await racerHere(player, args[1] || null, { strangers: true });
    if (!row) return say(dim(await lockedRacerHere(player) ? 'It is locked, and it is not yours.' : 'That racer is not parked where you are standing.'));
    return mountRacer(player, row);
  }
  const row = await racerHere(player, null, { strangers: true });
  if (row) return mountRacer(player, row);
  const shut = await lockedRacerHere(player);
  if (shut) return say(dim(`The ${shut.name || 'racer'} parked here is locked, and it is not yours.`));
  const here = getZone(player.current_zone);
  if (isLot(here)) {
    const mine = await myRacers(player.id);
    return say(`<span class="text-cyan">THE RACER BAY</span>\n${stockLines()}`
      + (mine.length ? `\n\n<span class="text-cyan">YOURS</span>\n${mine.map(racerLine).join('\n')}` : '')
      + `\n\n${dim('<b>podracer buy</b> or <b>podracer hire</b>. A racer of yours in the bay: <b>podracer take &lt;id&gt;</b>.')}`);
  }
  return say(dim('You have no racer parked here. <b>podracers</b> says where yours are.'));
}

// The spray booth: standing in the bay with the racer on the blocks, or sitting in it on the bay
// door, where the live racer takes the new paint at once. `podracer paint [id] <scheme | base=#hex
// trim=#hex finish=...>`.
async function paintCmd(player, tokens) {
  const id = tokens[0] && /^pod_/.test(tokens[0]) ? tokens.shift() : null;
  let row = null;
  if (seated.has(player.id)) {
    const rig = rigs.get(player.id);
    const lot = rig && Number.isFinite(rig.x) && (rig.speed || 0) <= 3 ? bayLotAt(rig.x, rig.y) : null;
    if (!lot) return say(dim('Bring it into the shed door and stop. The booth is in there.'));
    if (!isLot(getZone(lot))) return say(dim('This shed only keeps racers. The spray booth is in the racer bay at the Deadleg.'));
    const r = await query('SELECT * FROM podracers WHERE id = $1 AND owner_id = $2', [seated.get(player.id), player.id]);
    row = r.rows[0] || null;
  } else {
    if (!isLot(getZone(player.current_zone))) return say(dim('The spray booth is in the racer bay at the Deadleg.'));
    row = await racerHere(player, id);
  }
  if (!row) return say(dim('You have no racer in the bay to paint.'));
  const { ok, livery, out } = await paintRow(player, row, tokens);
  if (ok && seated.get(player.id) === row.id) {
    const rig = rigs.get(player.id);
    if (rig) rig.livery = livery;
    sendToPlayer(player.id, { type: 'podracer_ctx', livery });
    textPodCtx(player.id, { livery });
  }
  await repush(player);
  return out;
}

// The fitting shop, in the same places as the booth: `podracer fit [id] <slot=value ...>`. Bare, the
// menu with this racer's kit and the prices. Sitting in it on the bay door, the live racer takes the
// new parts at once: the seat swaps its row (podracer_ctx `params`), the envelope its top speed.
async function fitCmd(player, tokens) {
  const id = tokens[0] && /^pod_/.test(tokens[0]) ? tokens.shift() : null;
  let row = null;
  if (seated.has(player.id)) {
    const rig = rigs.get(player.id);
    const lot = rig && Number.isFinite(rig.x) && (rig.speed || 0) <= 3 ? bayLotAt(rig.x, rig.y) : null;
    if (!lot) return say(dim('Bring it into the shed door and stop. The fitting shop is in there.'));
    if (!isLot(getZone(lot))) return say(dim('This shed only keeps racers. The fitting shop is in the racer bay at the Deadleg.'));
    const r = await query('SELECT * FROM podracers WHERE id = $1 AND owner_id = $2', [seated.get(player.id), player.id]);
    row = r.rows[0] || null;
  } else {
    if (!isLot(getZone(player.current_zone))) return say(dim('The fitting shop is in the racer bay at the Deadleg.'));
    row = await racerHere(player, id);
  }
  if (!row) return say(dim('You have no racer in the bay to fit.'));
  if (!tokens.length) return fitMenu(row);
  const { ok, kit, params, out } = await fitRow(player, row, tokens);
  if (ok && seated.get(player.id) === row.id) {
    const rig = rigs.get(player.id);
    if (rig) { rig.kit = kit; rig.p = params; rig.look = null; }
    sendToPlayer(player.id, { type: 'podracer_ctx', params, kit });
    textPodCtx(player.id, { params, kit });
  }
  await repush(player);
  return out;
}

// Servicing: standing in the bay with the racer on the blocks, or sitting in it on the bay door.
async function serviceCmd(player, id) {
  if (seated.has(player.id)) {
    const rig = rigs.get(player.id);
    const lot = rig && Number.isFinite(rig.x) && (rig.speed || 0) <= 3 ? bayLotAt(rig.x, rig.y) : null;
    if (!lot) return say(dim('Bring it into the shed door and stop. The yard services it there.'));
    if (!isLot(getZone(lot))) return say(dim('This shed only keeps racers. Servicing is done in the racer bay at the Deadleg.'));
    const r = await query('SELECT * FROM podracers WHERE id = $1 AND owner_id = $2', [seated.get(player.id), player.id]);
    if (!r.rows[0]) return null;
    // The row lags the live racer by up to ten seconds; the quote is for the racer as it stands.
    const row = { ...r.rows[0], condition: rig.hull ?? r.rows[0].condition, fuel: rig.fuel ?? r.rows[0].fuel,
      custom_data: { ...(r.rows[0].custom_data || {}), eng: rig.eng, cables: rig.cables, binder: rig.binder !== false } };
    const { ok, out } = await serviceRow(player, row);
    if (ok) {
      // The live racer is put right too, or the next sync's one-way clamp writes the old wear back.
      Object.assign(rig, { hull: 1, fuel: 1, eng: [1, 1], cables: [true, true], binder: true });
      const fixed = { hull: 1, fuel: 1, eng: [1, 1], cables: [true, true], binder: true };
      sendToPlayer(player.id, { type: 'podracer_ctx', ...fixed });
      // A racer driven by text takes it the same way (texthelm.js).
      textPodCtx(player.id, fixed);
    }
    await repush(player);
    return out;
  }
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('Servicing is done in the racer bay at the Deadleg. Bring it back there.'));
  const row = await racerHere(player, id);
  if (!row) return say(dim('You have no racer in the bay.'));
  const { out } = await serviceRow(player, row);
  await repush(player);
  return out;
}

export const commands = {
  podracer: cmdPodracer,
  podracers: (args, raw, player) => listRacers(player),
  // The text helm's orders, on the textgames and log Display Mode rungs (texthelm.js).
  pod: cmdPod,
  // Not typed by players: the seat's telemetry and its event reports, on the same wire `boatsync`
  // uses. Both are in NOT_PLAYER_TYPED in scripts/docs/verbs.mjs.
  podsync: cmdPodSync,
  podevent: cmdPodEvent,
};

// ── Arriving and leaving ───────────────────────────────────────────────────────
// The counter opens walking into a lot room and closes walking out, and a login standing in one
// deals it (a moment later, after a reload's old logout has cleared the seat). The close is only
// sent to somebody who was in a lot room, never on every step anyone takes.
on('zone.entered', async ({ actor, zone, from }) => {
  if (!actor?.id) return;
  try {
    const to = zone?.id || zone;
    if (isLot(getZone(to))) { await pushDepot(actor); return; }
    if (from && isLot(getZone(from))) sendToPlayer(actor.id, { type: 'podracer_close' });
  } catch (e) { console.error('[podracer] counter:', e.message); }
});
on('player.login', ({ id }) => {
  setTimeout(() => { const p = getLivePlayer(id); if (p) pushDepot(p).catch(() => {}); }, 1200);
});

// ── Leaving the game leaves the seat ───────────────────────────────────────────
const events = {
  'player.logout': ({ id }) => { if (id) dropSeat(id); },
  'player.login': ({ id }) => { if (id) dropSeat(id); },
  'player.death': ({ player }) => {
    if (!player?.id || !seated.has(player.id)) return;
    dropSeat(player.id);
    sendToPlayer(player.id, { type: 'podracer_sim_close' });
  },
};
for (const [name, fn] of Object.entries(events)) on(name, (payload) => { try { fn(payload || {}); } catch (e) { console.error('[podracer] ' + name + ':', e.message); } });

// ── A racer left on the highway ────────────────────────────────────────────────
// A racer parked on the corridor is parked in a transient crossing room. When the crossing ends it
// goes to the tile the crossing set out from (the rim), as the trucks do, and a restart puts any
// racer still in an `xing_…` room in the first racer bay, since the rim it came from is gone with
// the RAM. Fired before the rooms are unregistered: voidwalking's teardownInstance.
export async function recoverRacersFrom(rooms, home) {
  if (!rooms?.length || !home) return 0;
  const { rowCount } = await query(
    `UPDATE podracers SET park_zone = $1, custom_data = COALESCE(custom_data, '{}'::jsonb) - 'heading' WHERE park_zone = ANY($2)`,
    [home, rooms]).catch(() => ({ rowCount: 0 }));
  return rowCount || 0;
}
on('crossing.ended', async ({ rooms, origin }) => {
  const n = await recoverRacersFrom(rooms, origin || homeLot()).catch(() => 0);
  if (n) console.log(`[podracer] ${n} racer(s) left on a crossing that ended are back on the rim.`);
});
// Racers left on open tiles, into the parked index once at boot (vehicle-access.js), and the latch
// `lock racer` / `unlock racer` reaches from outside.
registerVehicleLock('racer', setRacerLocked);
setTimeout(async () => {
  const { rows } = await query(`SELECT id, type_id, name, owner_id, park_zone, custom_data FROM podracers WHERE owner_id IS NOT NULL`).catch(() => ({ rows: [] }));
  for (const r of rows) noteRacerParked(r, r.park_zone, r.custom_data?.locked !== false);
}, 0);
setTimeout(async () => {
  const { rows } = await query(`SELECT DISTINCT park_zone FROM podracers WHERE park_zone LIKE 'xing\\_%'`).catch(() => ({ rows: [] }));
  if (!rows.length) return;
  const n = await recoverRacersFrom(rows.map((r) => r.park_zone), homeLot()).catch(() => 0);
  if (n) console.log(`[podracer] ${n} racer(s) stranded in void rooms by a restart are back in the bay.`);
}, 0);

export const _test = { racerContactsNear, pushDepot, recoverRacersFrom };
