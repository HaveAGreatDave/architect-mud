// AA-sites plugin regression — the pure on-foot panel renderer (MANNED / FIRING /
// under-repair / cold-ruin) + the describeRoom hook's "not an AA tile → stay out of
// the way" contract. Firing/repair state and the DB roster are runtime, so we test the
// render logic directly (no seeding needed).
import { _test, hooks } from './index.js';
import { getAllZones } from '../../server/engine/world.js';
import { deriveSurfaceCell, worldContactsNear } from '../flight/state.js';
import { rigs as boatRigs } from '../powerboat/index.js';
import { drawAAEmplacement, AA_KINDS, _aaResetAim } from '../../client/game/js/panels/glass/aa-emplacement.js';

export default async function regress({ check }) {
  const { panelFor } = _test;

  const manned = panelFor({ name: 'a wastes autocannon', faction: null, active: 1 }, false, false);
  check('aa-sites: manned panel names the battery', manned.includes('a wastes autocannon'), manned);
  check('aa-sites: manned panel reads MANNED', manned.includes('MANNED'), manned);

  const firing = panelFor({ name: 'the Redline SAM nest', faction: 'redline', active: 1 }, true, false);
  check('aa-sites: firing panel reads FIRING', firing.includes('FIRING'), firing);
  check('aa-sites: faction is tagged', firing.includes('redline'), firing);

  // Strafed but a living engineer is on it → OFF-LINE, UNDER REPAIR (not a dead ruin).
  const repairing = panelFor({ name: 'a Slagworks flak gun', faction: null, active: 0 }, false, true);
  check('aa-sites: strafed-with-engineer reads UNDER REPAIR', /UNDER REPAIR/.test(repairing), repairing);
  check("aa-sites: under-repair panel isn't a ruin", !/ruin/i.test(repairing), repairing);

  // Strafed with no engineer to fix it → the cold ruin.
  const dead = panelFor({ name: 'a Slagworks flak gun', faction: null, active: 0 }, false, false);
  check('aa-sites: silenced-with-no-engineer reads as a ruin', /ruin/i.test(dead), dead);
  check("aa-sites: ruin panel isn't MANNED", !dead.includes('MANNED'), dead);

  // describeRoom stays out of the way on a tile that carries no AA site.
  const none = await hooks['zone.describeRoom']({ id: 'zone_aa_regress_nonexistent' });
  check('aa-sites: describeRoom returns undefined off an AA tile', none === undefined, String(none));

  // ── The battery as every view draws it ──
  // `aa.state` is gathered SYNC from the map window, so it must answer from RAM and never return a
  // promise; off an AA tile it answers nothing.
  const none2 = hooks['aa.state']('zone_aa_regress_nonexistent');
  check('aa-sites: aa.state answers nothing off an AA tile', none2 === undefined, String(none2));
  check('aa-sites: stateOf reads 1 for a manned battery', _test.stateOf({ id: 'x', active: 1 }) === 1);
  check('aa-sites: …and 0 for a silenced one with no engineer', _test.stateOf({ id: 'aa_regress_no_engineer', active: 0 }) === 0);

  // The deck tile's map cell carries the mark, the kind and the state, which is all a view has to go
  // on. Derived from the live world, so a battery added or moved needs no change here.
  const deck = getAllZones().find((z) => z.flags?.aa_site && z.map_id === 'map_world');
  if (deck) {
    const cell = deriveSurfaceCell({ id: deck.id, flags: deck.flags, danger: deck.danger }, deck.grid_x, deck.grid_y);
    check('aa-sites: the deck tile is an `aa` mark', cell.mark === 'aa', JSON.stringify({ mark: cell.mark }));
    check('aa-sites: …with a kind the model knows', AA_KINDS.includes(cell.aa?.k), JSON.stringify(cell.aa));
    check('aa-sites: …a state', [0, 1, 2].includes(cell.aa?.s), JSON.stringify(cell.aa));
    check('aa-sites: …and the side it opens to', /^[nesw]$/.test(cell.aa?.o || '') || !!cell.cur, JSON.stringify(cell.aa));
    check('aa-sites: …and is not a building, so people can stand on it', !cell.bt, String(cell.bt));
  }
  for (const z of getAllZones().filter((zz) => zz.flags?.aa_site)) {
    check(`aa-sites: ${z.id} names its build (flags.aa_kind)`, AA_KINDS.includes(z.flags.aa_kind), String(z.flags.aa_kind));
  }

  // Every kind in every state draws, near and far, and a ruin is a different build, not a recolour.
  const build = (kind, st, near, extra = {}) => {
    const faces = [], lights = [];
    _aaResetAim();
    drawAAEmplacement({ dx: 0, dy: -3, wx: 1, wy: 1, kind, s: st, open: [1, 0], eye: [0, 0, 0.2], target: null, firing: 0, near,
      seed: 3, now: 1000, night: 1, alpha: 1, wet: 0, sun: null, face: (pts) => faces.push(pts), light: (...a) => lights.push(a), ...extra });
    return { faces, lights };
  };
  for (const kind of AA_KINDS) for (const st of [0, 1, 2]) {
    const near = build(kind, st, true), far = build(kind, st, false);
    check(`aa-sites: ${kind} draws in state ${st}`, near.faces.length > 40, String(near.faces.length));
    check(`aa-sites: …and draws less from a distance`, far.faces.length <= near.faces.length, `${far.faces.length} > ${near.faces.length}`);
    check(`aa-sites: …with no point off the tile or underground`,
      near.faces.every((p) => p.every(([x, y, z]) => Math.abs(x) <= 0.62 && Math.abs(y + 3) <= 0.62 && z >= 0)),
      kind + ':' + st);
  }
  check('aa-sites: a ruin is a different build', build('guardian', 0, true).faces.length !== build('guardian', 1, true).faces.length);
  check('aa-sites: a ruin shows no light at night', build('guardian', 0, true).lights.length === 0);
  check('aa-sites: a manned battery does', build('guardian', 1, true).lights.length > 0);
  // Firing lights a muzzle; a battery under repair never fires.
  // The bores flash alternately and each is dark half its cycle, so a burst is sampled across a
  // second rather than at one instant that may fall in the dark half.
  const quiet = build('guardian', 1, true).lights.length;
  const fired = Math.max(...[1000, 1030, 1060, 1090, 1120, 1150].map((now) => build('guardian', 1, true, { firing: 1, now }).lights.length));
  check('aa-sites: firing lights a muzzle', fired > quiet, `${fired} vs ${quiet}`);
  check('aa-sites: …and one under repair never fires', build('guardian', 2, true, { firing: 1, now: 1100 }).lights.length === build('guardian', 2, true).lights.length);

  // ── What is moving near a tile, for any view ──
  // A boat on the water is in it, and the asker's own hull is not.
  boatRigs.set('aa_regress_boat', { playerId: 'aa_regress_boat', x: 918, y: 900, heading: 0, speed: 10, typeId: 'hydro', hull: 1 });
  try {
    const seen = worldContactsNear(918, 901, 6);
    check('contacts: a boat near the tile is in the list', seen.some((c) => c.id === 'boat_aa_regress_boat'), JSON.stringify(seen.map((c) => c.id)));
    const own = worldContactsNear(918, 901, 6, 'boat_aa_regress_boat');
    check('contacts: …and not in its own', !own.some((c) => c.id === 'boat_aa_regress_boat'));
  } finally { boatRigs.delete('aa_regress_boat'); }
}
