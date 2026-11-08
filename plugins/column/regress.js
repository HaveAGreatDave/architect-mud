// column regression suite: run by tests/regress.js, never loaded in production.
//
// What it proves: the loop never puts a rig on a cliff, in water or through a building (the thorn
// wall is a `building_type`); the column is the same at the same instant and moves at the
// timetable's speed; the contact feed answers inside its range and not outside it, as class
// `column` with a variant the mesh file knows; and the passing line reaches somebody standing on a
// tile the column drives onto, and the near line somebody next to it.
import { _test as C } from './index.js';
import { columnAt, routeTiles, WAYPOINTS, STOPS, PERIOD_S, LOOP_TILES, TILES_PER_S, RIGS,
  houndsAt, HOUNDS, HOUND_COUNT_MIN, HOUND_COUNT_MAX, HOUND_AHEAD, HOUND_REST, HOUND_SURGE, LANE, HOUND_SIDE, HOUND_WEAVE,
  offRoute, aheadOfLead } from '../../client/shared/column-route.js';
import { zoneAtTile, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { readFileSync } from 'node:fs';

export default async function regress({ check, getPlayer }) {
  // ── The ground under every leg ──
  const bad = [];
  for (const [x, y] of routeTiles(0.1)) {
    const z = zoneAtTile('map_world', x, y, 0);
    const f = z?.flags || {};
    if (!z) bad.push(x + ',' + y + ' (no tile)');
    else if (f.building_type) bad.push(x + ',' + y + ' (' + f.building_type + ')');
    else if (f.terrain === 'cliff' || f.terrain === 'water') bad.push(x + ',' + y + ' (' + f.terrain + ')');
  }
  check('column: every tile the loop drives over is open ground, off the wall, the cliffs and the water', bad.length === 0, bad.slice(0, 8).join('; '));
  const stopTile = (i) => zoneAtTile('map_world', WAYPOINTS[i][0], WAYPOINTS[i][1], 0);
  check('column: the yard stop is the Deadleg', stopTile(0)?.flags?.truck_yard === 'The Deadleg', stopTile(0)?.id);
  check('column: the gate stop is the North Gate apron, outside the wall', stopTile(9)?.id === 'zone_scw_1046_967', stopTile(9)?.id);
  check('column: a loop is a few minutes long, not hours', PERIOD_S > 600 && PERIOD_S < 3600, PERIOD_S);

  // ── The clock ──
  const T = 1_800_000_000_000;
  const a = columnAt(T), b = columnAt(T);
  check('column: the same instant gives the same column', JSON.stringify(a) === JSON.stringify(b));
  check('column: three rigs, in column order', a.length === 3 && a.map((r) => r.id).join() === RIGS.map((r) => r.id).join());
  // Find a moment the lead is a good way into a moving stretch and measure ten seconds of it.
  let moving = null;
  for (let t = T; t < T + PERIOD_S * 1000; t += 5000) {
    const p = columnAt(t), q = columnAt(t + 10_000);
    if (p[0].stop == null && q[0].stop == null && p[0].hdg === q[0].hdg) { moving = [p[0], q[0]]; break; }
  }
  check('column: the lead rig drives somewhere in the loop', !!moving);
  if (moving) {
    const d = Math.hypot(moving[1].x - moving[0].x, moving[1].y - moving[0].y);
    check('column: it covers ten seconds at the timetable speed', Math.abs(d - TILES_PER_S * 10) < 0.01, d.toFixed(3));
    check('column: a moving rig reports its speed', moving[0].ias > 0, moving[0].ias);
  }
  let standing = null;
  for (let t = T; t < T + PERIOD_S * 1000; t += 5000) { const p = columnAt(t); if (p[0].stop === 9) { standing = p; break; } }
  check('column: it stands at the North Gate at some point in the loop', !!standing);
  if (standing) {
    check('column: a standing rig reports no speed', standing.every((r) => r.ias === 0));
    const gap = Math.hypot(standing[1].x - standing[0].x, standing[1].y - standing[0].y);
    check('column: the cart closes up behind the Howl at a stop, not on top of it', gap > 0.8, gap.toFixed(2));
  }
  check('column: the stops are on the loop', Object.keys(STOPS).every((i) => WAYPOINTS[i]), Object.keys(STOPS).join());
  check('column: the loop is the length of its legs', LOOP_TILES > 100 && LOOP_TILES < 200, LOOP_TILES.toFixed(1));

  // ── Bracken's hounds ──
  // Worked out from the clock like the rigs, and not published as contacts. Sampled every 250 ms over
  // one whole loop: that's every stretch, every stop, every corner and both turnarounds.
  const hA = houndsAt(T).map((h) => ({ ...h })), hB = houndsAt(T).map((h) => ({ ...h }));
  check('column: the same instant gives the same hounds', JSON.stringify(hA) === JSON.stringify(hB));
  check('column: a reused list is filled in place with the same pack', (() => { const o = []; houndsAt(T + 5000, o); const k = o[0]; houndsAt(T + 6000, o); return o[0] === k && JSON.stringify(o) === JSON.stringify(houndsAt(T + 6000)); })());
  check('column: four to six hounds', HOUNDS.length >= HOUND_COUNT_MIN && HOUNDS.length <= HOUND_COUNT_MAX && hA.length === HOUNDS.length, HOUNDS.length);
  const laneMax = LANE + HOUND_SIDE + HOUND_WEAVE + 0.005;
  let offWorst = 0, jump = 0, prevH = null, runAhead = [Infinity, -Infinity], spreadAhead = [Infinity, -Infinity];
  let stoppedSamples = 0, lyingWrong = 0, lieFar = 0, runAtStop = 0, cageFull = 0;
  const allStates = new Set();
  const out = [];
  for (let t = T; t < T + PERIOD_S * 1000; t += 250) {
    const rigs = columnAt(t);
    const hs = houndsAt(t, out);
    const standing = rigs[0].stop != null;
    if (standing) stoppedSamples++;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      allStates.add(h.state);
      offWorst = Math.max(offWorst, offRoute(h.x, h.y));
      if (prevH) jump = Math.max(jump, Math.hypot(h.x - prevH[i].x, h.y - prevH[i].y));
      if (standing) {
        if (h.state !== 'lie') lyingWrong++;
        if (Math.hypot(h.x - rigs[0].x, h.y - rigs[0].y) > HOUND_REST[1] + 0.3) lieFar++;
      } else if (h.state === 'lie') runAtStop++;
      // The hound-runner tows the cage; no hound is ever inside it (the cage is a tile and a bit behind the Howl).
      if (Math.hypot(h.x - rigs[2].x, h.y - rigs[2].y) < 0.25) cageFull++;
    }
    if ((t - T) % 2000 === 0) {
      for (const h of hs) if (h.state === 'run') {
        const ah = aheadOfLead(t, h.x, h.y);
        runAhead = [Math.min(runAhead[0], ah), Math.max(runAhead[1], ah)];
      }
      // Ten seconds into a stretch the pack is out at its spread.
      const lateRun = !standing && columnAt(t - 10_000)[0].stop == null;
      if (lateRun) for (const h of hs) if (h.state === 'run') {
        const ah = aheadOfLead(t, h.x, h.y);
        spreadAhead = [Math.min(spreadAhead[0], ah), Math.max(spreadAhead[1], ah)];
      }
    }
    prevH = hs.map((h) => ({ x: h.x, y: h.y }));
  }
  check('column: a hound never leaves the road the rigs drive', offWorst <= laneMax, offWorst.toFixed(3) + ' of ' + laneMax.toFixed(3));
  check('column: a hound never jumps, corners and turnarounds included', jump < TILES_PER_S * 0.25 * 2, jump.toFixed(3) + ' tiles in 250 ms');
  check('column: the pack runs, waits and lies down', ['run', 'walk', 'lie'].every((s) => allStates.has(s)), [...allStates].join());
  check('column: a running hound is in front of the Howl\'s plough', runAhead[0] > 0.4, runAhead.map((x) => x.toFixed(2)).join('..'));
  check('column: once the pack is out it runs 0.8 to 1.5 tiles ahead', spreadAhead[0] >= HOUND_AHEAD[0] - HOUND_SURGE - 0.02 && spreadAhead[1] <= HOUND_AHEAD[1] + HOUND_SURGE + 0.02, spreadAhead.map((x) => x.toFixed(2)).join('..'));
  check('column: while the column stands every hound lies down', stoppedSamples > 0 && lyingWrong === 0, lyingWrong + ' of ' + stoppedSamples * HOUNDS.length);
  check('column: they lie near the Howl', lieFar === 0, lieFar);
  check('column: no hound lies down while the column drives', runAtStop === 0, runAtStop);
  check('column: the cage stays empty', cageFull === 0, cageFull);
  check('column: the hounds are not contacts', C.columnContactsNear(a[0].x, a[0].y, 26, T).every((c) => !/hound_/.test(c.id)));

  // ── The contact feed ──
  const lead = a[0];
  const near = C.columnContactsNear(lead.x, lead.y, 26, T);
  check('column: contacts inside range are published', near.length >= 1 && near[0].cls === 'column', JSON.stringify(near[0])?.slice(0, 160));
  check('column: a contact is a ground contact', near.every((c) => c.band === 'ground' && c.onGround === true && c.groundZ === 0));
  check('column: nothing is published from across the map', C.columnContactsNear(lead.x + 200, lead.y + 200, 26, T).length === 0);
  const mesh = JSON.parse(readFileSync(new URL('../../content/vehicle_models/mesh_column.json', import.meta.url), 'utf8'));
  const known = new Set(['howl', ...Object.keys(mesh.params.variants || {})]);
  check('column: every rig\'s variant is a model the class file draws', RIGS.every((r) => known.has(r.variant)), RIGS.map((r) => r.variant).join());

  // ── The text rung ──
  const P = getPlayer();
  // A moment when the lead is driving onto a tile it wasn't on a moment before.
  let enter = null;
  for (let t = T; t < T + PERIOD_S * 1000 && !enter; t += 1000) {
    const p = columnAt(t)[0], q = columnAt(t - 1000)[0];
    if (p.stop == null && (Math.round(p.x) !== Math.round(q.x) || Math.round(p.y) !== Math.round(q.y))) enter = { t, x: Math.round(p.x), y: Math.round(p.y), hdg: p.hdg };
  }
  check('column: the lead drives onto a new tile somewhere', !!enter);
  if (enter && P) {
    const zone = zoneAtTile('map_world', enter.x, enter.y, 0);
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => zoneAtTile('map_world', enter.x + dx, enter.y + dy, 0)).find(Boolean);
    const got = [];
    const saved = getBroadcast();
    setBroadcast((_z, message, _ex, targetId) => { if (targetId === P.id && message?.type === 'ambient') got.push(message.message); });
    try {
      C.resetTicks();
      C.columnTick(enter.t - 1000);
      addPlayerToZone(P.id, zone.id);
      C.columnTick(enter.t);
      check('column: somebody on the tile hears the Howl come through', got.some((m) => /Howl/.test(m)), got.join(' | ').slice(0, 200));
      removePlayerFromZone(P.id, zone.id);
      got.length = 0;
      C.columnTick(enter.t + 1000);
      check('column: a line goes out once per tile, not every tick', !got.some((m) => /Howl/.test(m)), got.join(' | ').slice(0, 200));
      if (side) {
        got.length = 0;
        C.resetTicks();
        C.columnTick(enter.t - 1000);
        addPlayerToZone(P.id, side.id);
        C.columnTick(enter.t);
        check('column: somebody next to the tile hears it close', got.some((m) => /no muffler/.test(m)), got.join(' | ').slice(0, 200));
        removePlayerFromZone(P.id, side.id);
      }
      check('column: no line carries an em dash', [...got].every((m) => !m.includes('—')));
    } finally {
      setBroadcast(saved);
      removePlayerFromZone(P.id, zone.id);
      if (side) removePlayerFromZone(P.id, side.id);
      C.resetTicks();
    }
  }
}
