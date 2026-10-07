// SUBMERSIBLE — the Drake goes under.
//
// A salvage frontier: the seabed is `client/shared/seabed.js`, one deterministic function of
// position that every client and this server agree about with nothing stored. This plugin owns the
// dive itself: the verbs, the air and power budget, and the crush depth. The arithmetic lives in
// sub.js so regress can drive it; this file reads the live aircraft (plugins/flight/state.js, the
// same import powerboat makes) and narrates.
//
// ⚠ STATE IS RAM ONLY. A dive is minutes long; a restart surfaces every Drake, which is the safe
// direction. The durable residue is hull damage, written through flight's own `persist`.
//
// ⚠ THE SERVER DECIDES SHE IS UNDER. The client only stops treating her as a boat when told
// (`drake_sub`), because depth, air and crush are judgements a client must not make for itself.

import { schedule } from '../../server/engine/scheduler.js';
import { getZone } from '../../server/engine/world.js';
import { biomeOf } from '../flight/biomes.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { liveAircraft, surfaceAt, bounds, persist, persistIfChanged, pushHud, crash, toOccupants } from '../flight/state.js';
import { seabedDepth, seabedMaterial, wrecksNear } from '../../client/shared/seabed.js';
import { wildlandsAt } from '../../client/shared/wildlands.js';
import { newSub, stepSub, tierOf, bearing, regenAir, MIN_WATER, MIN_AIR_FRAC, HULL_TIERS, FLOOD_S, BLOW_S } from './sub.js';

// aircraftId → sub state (see sub.js newSub)
export const subs = new Map();

// ── LAND, AS THE SERVER KNOWS IT ────────────────────────────────────────────────────────────────
// The seabed takes land as a predicate, and it is the render LUT's own rule (windshield.js groundLUT),
// because the cockpit's SUB gate reads its depth off that LUT. A tile with a zone is water when the
// biome the map window sends for it is water or hotspring (flight/biomes.js biomeOf), which takes in
// the Deadwater's hot lake and the Echelon's mooring as well as painted water terrain.
//
// THE DEEP. A tile with NO zone is open sea where `wildlandsAt` says so (client/shared/wildlands.js),
// which is the answer the floor is painted from (windshield.js fillOffMap). So the sea a pilot sees
// past the bay and the sea the seabed is measured against are one sea, and shore distance grows past
// the harbour mouth until the shelf, the drop-off and the abyss in seabed.js appear on their own.
// ⚠ The client's copy of this rule is the render LUT itself (seabed-scene.js landFromLUT reads the
// filled window), so changing one side without the other makes the SUB gate and the server disagree.
// It did: this used its own column rule after fillOffMap moved to wildlandsAt, and on about 31,000
// off-map tiles the cockpit read deep water while the server read land and refused every dive.
const isWaterZone = (z) => { const bi = biomeOf(z); return bi === 'water' || bi === 'hotspring'; };
const landCache = new Map();
let landFor = null;   // the bounds() object the cache was filled against; a rebuilt world index is a new one
export function isLandTile(ix, iy) {
  const b = bounds();
  if (b !== landFor) { landCache.clear(); landFor = b; }
  const k = ix + ',' + iy;
  let v = landCache.get(k);
  if (v === undefined) {
    const s = surfaceAt(ix, iy);
    v = s ? !isWaterZone(getZone(s.id)) : !wildlandsAt(ix, iy).sea;
    if (landCache.size > 20000) landCache.clear();
    landCache.set(k, v);
  }
  return v;
}
// ⚠ TWO TILE CONVENTIONS MEET HERE. Flight's `fx` puts a tile's CENTRE on the integer
// (`grid_x = Math.round(fx)`), while seabed.js has tile i spanning [i, i+1). Half a tile, added once.
const posOf = (live) => ({ x: (live.fx ?? live.row.grid_x) + 0.5, y: (live.fy ?? live.row.grid_y) + 0.5 });
export const floorUnder = (live) => { const p = posOf(live); return seabedDepth(p.x, p.y, isLandTile); };

// The tanks. RAM on the live aircraft, seeded from the row the first time anything asks, full if
// the row has never held a figure.
export const airMaxOf = (live) => tierOf(live.row.custom_data?.hull_tier || 1).air;
export function airOf(live) {
  if (live.subAir == null) {
    const saved = live.row.custom_data?.sub_air;
    live.subAir = Number.isFinite(+saved) && saved != null ? Math.min(airMaxOf(live), +saved) : airMaxOf(live);
  }
  return live.subAir;
}
const airClock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function pilotDrake(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { err: "You're not aboard anything that could go under." };
  if (player.seat !== 'pilot') return { err: "You're not in the pilot's seat." };
  if (live.type?.class !== 'drake') return { err: "This airframe was never built to go under. It would do it once." };
  if (live.row.is_wreck) return { err: 'She already went under, in the other sense.' };
  return { live };
}

function tell(live, sub) {
  for (const pid of live.occupants) sendToPlayer(pid, {
    type: 'drake_sub', depth: sub ? Math.round(sub.depth * 10) / 10 : 0,
    air: Math.round(sub ? sub.air : airOf(live)), airMax: sub ? sub.airMax : airMaxOf(live),
    rating: sub ? sub.rating : null, surfaced: !sub,
    // The tanks, for the HUD gauge and the vents: how full, which way they are going, and how long a
    // full fill or blow takes, so the client can animate between these once-a-second reports.
    ballast: sub ? Math.round(sub.ballast * 100) / 100 : 0, blow: sub ? !!sub.blow : true,
    floodS: FLOOD_S, blowS: BLOW_S,
    floor: sub ? Math.round(floorUnder(live) * 10) / 10 : null,
  });
}

const fmt = (m) => `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;

// A dive refused from the surface. The sentence goes to the log as the reply; the short reason goes
// to the cockpit as well, because the SUB button otherwise only learns that nothing happened and
// can say no more than that she would not go under.
function refuse(player, message, why) {
  sendToPlayer(player.id, { type: 'drake_sub', refused: why });
  return { type: 'emote', message };
}
function status(sub, live) {
  const floor = floorUnder(live);
  return `Depth ${fmt(sub.depth)} of ${fmt(floor)} to the bottom. Hull rated to ${sub.rating} m. ` +
    `Air ${airClock(sub.air)} of ${airClock(sub.airMax)}.` + (sub.depth > sub.rating ? ' She is past her rating and she knows it.' : '');
}

// submerge            → go down to 5 m (or to the bottom, if it is shallower)
// submerge <metres>   → go to that depth
// submerge floor      → sit on the bottom
// submerge planes <v> → fly the depth on the dive planes, -1 rise .. +1 dive (the stick sends this)
// submerge (under)    → read the gauges
async function cmdSubmerge(args, raw, player) {
  const { live, err } = pilotDrake(player);
  if (err) return { type: 'emote', message: err };
  const floor = floorUnder(live);
  let sub = subs.get(live.row.id);
  const a = (args[0] || '').toLowerCase();
  if (sub && !a) return { type: 'emote', message: status(sub, live) };
  if (a === 'planes') {
    // Silent: the client sends it several times a second while the stick is off centre.
    const v = parseFloat(args[1]);
    if (!sub || !Number.isFinite(v)) return { type: 'noop' };
    sub.planes = Math.max(-1, Math.min(1, v));
    sub.planesAt = Date.now() / 1000;
    return { type: 'noop' };
  }

  let target;
  if (a === 'floor' || a === 'bottom') target = Infinity;
  else if (a) {
    target = parseFloat(a);
    if (!Number.isFinite(target) || target <= 0) return { type: 'emote', message: 'Submerge to how deep? A number of metres, or "floor".' };
  } else target = 5;

  if (!sub) {
    if (!live.shape?.boat || live.cont?.onGround === false) {
      return refuse(player, 'She has to be on the water in BOAT mode before she can go under.', 'not settled on the water in BOAT');
    }
    if (floor < MIN_WATER) return refuse(player, `There's ${fmt(floor)} of water under her. Not enough to hide a duck in.`, `${fmt(floor)} under her by sonar, needs ${MIN_WATER} m`);
    const air = airOf(live), max = airMaxOf(live);
    if (air < max * MIN_AIR_FRAC) return refuse(player, `The air gauge reads ${airClock(air)} of ${airClock(max)}. Not enough to go under on. Run the engine on the surface to refill her.`, `air ${airClock(air)} of ${airClock(max)}, run the engine to refill`);
    sub = newSub(live.row.custom_data?.hull_tier || 1, target, air);
    subs.set(live.row.id, sub);
    tell(live, sub);
    toOccupants(live, 'The vents open along her flanks. She settles, takes a breath she cannot keep, and the water closes over the canopy.');
    return { type: 'noop' };
  }
  if (sub.air <= 0) return { type: 'emote', message: 'The tanks are empty. The only way she is going is up.' };
  sub.target = target;
  sub.blow = false;          // an order to go down floods the tanks again
  sub.emergency = false;
  const where = target === Infinity ? 'the bottom' : fmt(Math.min(target, floor));
  return { type: 'emote', message: `You trim her for ${where}.` };
}

async function cmdSurface(args, raw, player) {
  const { live, err } = pilotDrake(player);
  if (err) return { type: 'emote', message: err };
  const sub = subs.get(live.row.id);
  if (!sub) return { type: 'emote', message: "She's already on top of the water. That's the part with the air." };
  sub.target = 0;
  sub.blow = true;
  toOccupants(live, 'You blow the ballast. Air roars into the tanks and she starts to rise, nose first, like something remembering it can float.');
  return { type: 'noop' };
}

// Sonar: the floor under her and what is lying on it nearby. Works on the surface too.
async function cmdSonar(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live || live.type?.class !== 'drake') return { type: 'emote', message: "There's no sonar where you are." };
  const p = posOf(live);
  const floor = seabedDepth(p.x, p.y, isLandTile);
  if (floor <= 0) return { type: 'emote', message: 'The sonar pings once and hears ground. She is not over water.' };
  const mat = seabedMaterial(p.x, p.y, isLandTile);
  const lines = [`Bottom at ${fmt(floor)}, ${mat}. Air ${airClock(airOf(live))} of ${airClock(airMaxOf(live))}.`];
  const near = wrecksNear(p.x, p.y, 20, isLandTile).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  const KIND = { skiff: 'something small and boat-shaped', container_stack: 'a stack of hard edges', freighter: 'a long hull on its side', server_farm: 'a grid of cabinets, too regular to be rock', hero: 'something enormous' };
  for (const w of near.slice(0, 5)) {
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    lines.push(`  ${KIND[w.kind] || 'a contact'}, ${bearing(w.x - p.x, w.y - p.y)}, ${Math.round(d * 7)} m off, ${fmt(w.depth)} down`);
  }
  for (const [id, other] of subs) {
    if (id === live.row.id) continue;
    const o = liveAircraft.get(id); if (!o) continue;
    const q = posOf(o), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= 20) lines.push(`  a hull under power, ${bearing(q.x - p.x, q.y - p.y)}, ${Math.round(d * 7)} m off, ${fmt(other.depth)} down`);
  }
  if (lines.length === 1) lines.push('  Nothing on the bottom that is not the bottom.');
  return { type: 'emote', message: lines.join('\n') };
}

const LINES = {
  shoal: 'The sonar shrieks: the bottom is coming up to meet her. She rises with it.',
  air50: 'The air has gone thick and warm. Half the tanks are spent.',
  air25: 'A quarter of the air left. Everyone aboard is breathing like they mean it.',
  air10: 'The air alarm starts, a flat tone that does not stop. Surface.',
  emergency: 'Out of air. The emergency blow fires on its own, and she goes up hard enough to hurt.',
  creak: 'The hull creaks. It is a long, patient sound, the sound of something doing arithmetic.',
  rivet: 'Something lets go aft with a noise like a gunshot. A fine spray starts from nowhere in particular.',
  surfaced: 'She breaks the surface and rolls, streaming, and the canopy clears.',
};

// Write the tanks back to the row. RAM (`live.subAir`) is the authority while the process runs;
// custom_data is only so a restart does not hand every Drake full tanks.
function banked(live) {
  const cd = live.row.custom_data || (live.row.custom_data = {});
  cd.sub_air = Math.round(live.subAir);
}

export async function subTick() {
  for (const [id, sub] of subs) {
    const live = liveAircraft.get(id);
    // Gone, wrecked, abandoned, or airborne (a VTOL can lift straight out): the dive is over.
    if (!live || live.row.is_wreck || !live.occupants.size || live.cont?.onGround === false) {
      subs.delete(id);
      if (live) { live.subAir = sub.air; banked(live); tell(live, null); }
      continue;
    }
    const { ev, damage } = stepSub(sub, 1, floorUnder(live), Date.now() / 1000);
    live.subAir = sub.air;
    for (const e of ev) if (LINES[e] && e !== 'surfaced') toOccupants(live, LINES[e]);
    if (damage > 0) {
      live.row.damage = Math.min(1, (live.row.damage || 0) + damage);
      if (live.row.damage >= 1) {
        toOccupants(live, 'The hull stops arguing.');
        subs.delete(id);
        tell(live, null);
        await crash(live, 'imploded');
        continue;
      }
      pushHud(live);
      sub._dirty = true;
    }
    if (ev.includes('surfaced')) {
      subs.delete(id);
      tell(live, null);
      toOccupants(live, LINES.surfaced + (live.row.engine_on ? '' : ' The compressor is on the engine; start her to refill the tanks.'));
      banked(live);
      persist(live).catch(() => {});
      continue;
    }
    tell(live, sub);
    // Hull damage is written once, within 5 s of the hit, and the flag clears; it is set again
    // only by the next hit. It used to stay set, so one scrape wrote the row every 5 s until
    // she surfaced. persistIfChanged also skips the write when nothing moved since the last one.
    if (sub._dirty && (sub._n = (sub._n || 0) + 1) % 5 === 0) {
      sub._dirty = false;
      banked(live);
      persistIfChanged(live).catch(() => {});
    }
  }
}

// THE COMPRESSOR. Every Drake that is up (not submerged) with her engine running refills her tanks.
// Only Drakes whose tanks have ever been drawn on carry `subAir`, so the loop touches nothing else.
export function regenTick(dt = 1) {
  for (const live of liveAircraft.values()) {
    if (live.subAir == null || subs.has(live.row.id) || live.row.is_wreck) continue;
    const max = airMaxOf(live);
    if (live.subAir >= max) continue;
    if (!live.row.engine_on) continue;
    live.subAir = regenAir(live.subAir, max, dt);
    if ((live._regenT = (live._regenT || 0) + 1) % 2 === 0 || live.subAir >= max) tell(live, null);   // the gauge climbs on the HUD
    if (live.subAir >= max) {
      banked(live);
      toOccupants(live, 'The compressor note drops and the air gauge settles on full.');
      persist(live).catch(() => {});
    } else if ((live._regenN = (live._regenN || 0) + 1) % 15 === 0) { banked(live); persist(live).catch(() => {}); }
  }
}

schedule('1s', () => { regenTick(1); if (subs.size) subTick().catch(() => {}); });

export const commands = { submerge: cmdSubmerge, surface: cmdSurface, sonar: cmdSonar };
export { HULL_TIERS, tierOf };
