// podracer regression suite, run by tests/regress.js.
//
// The physics is a pure module, so it is stepped headless at 1/60 exactly as the seat steps it and
// the checks are about what the bodies do. The server half is checked through its pure envelope
// (`checkSync`) and the verbs' refusals, which write nothing.

import { PODRACER_TYPES, createPodracerState, stepPodracer, podracerParts, placePodracer, breakBinder, tornBinder, mendBinder, toggleDock } from '../../client/game/js/panels/podracer-model.js';
import { _test as seat, mountRacer, dropSeat, homeLot, seatContext, envelopeMph } from './seat.js';
import { _test as idx, rigs, seated } from './index.js';
import { _test as text, cmdPod } from './texthelm.js';
import { displayRung, setDisplayRung, DISPLAY_MODE_FLAG } from '../../server/engine/presentation.js';
import { setFlag } from '../../server/engine/flags.js';
import { getZone, setLivePlayer, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { surfaceAt, mapWindow } from '../flight/state.js';
import { regionGates } from '../trucking/state.js';
import { corridorPos, roomLenOf, nodeAt } from '../trucking/corridor.js';
import { _test as voidTest } from '../voidwalking/index.js';
import * as lot from './lot.js';
import * as access from '../../server/engine/vehicle-access.js';
import { noteRacerParked } from './seat.js';
import { PODRACER_KIT, PART_EXCHANGE, cleanKit, podracerTuned, podracerLook, podracerLivery } from '../../client/game/js/panels/podracer-model.js';
import { compileMesh } from '../../client/shared/vehicle-mesh.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';

export default async function regress({ run, check, getPlayer }) {
  const p = PODRACER_TYPES.podracer;
  const DT = 1 / 60;
  // Most of what follows is about the racer at full stretch, so it starts launched; the dock has its own.
  const fresh = () => { const s = createPodracerState(p, { docked: false }); s.running = true; return s; };
  const drive = (s, input, secs) => { const ev = []; for (let i = 0; i < Math.round(secs / DT); i++) { stepPodracer(s, input, p, DT); ev.push(...s.events); } return ev; };
  const mid = (s) => { const P = podracerParts(s, p); return [(P.L.x + P.R.x) / 2, (P.L.y + P.R.y) / 2]; };
  const sep = (s) => { const [mx, my] = mid(s); return Math.hypot(mx - s.x, my - s.y); };
  // The pod's offset across the turbines' heading: positive is to their right.
  const across = (s) => { const [mx, my] = mid(s), a = s.eng[0].a; return (s.x - mx) * Math.cos(a) + (s.y - my) * Math.sin(a); };

  // ── The physics ─────────────────────────────────────────────────────────────
  {
    const s = createPodracerState(p);
    drive(s, { left: 1, right: 1 }, 2);
    check('a cold racer does not move on the levers', s.speed < 0.5, s.speed.toFixed(2));
    const ev = drive(s, { starter: true }, 1.5);
    check('holding the starter lights the turbines', s.running && ev.includes('started'));
    const dry = createPodracerState(p);
    const evd = drive(dry, { starter: true, fuel: 0 }, 2);
    check('a dry racer turns over and never lights', !dry.running && evd.includes('dry'));
  }
  {
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 5);
    check('full levers make 150+ mph in five seconds', s.speed > 150, s.speed.toFixed(0));
    drive(s, { left: 1, right: 1 }, 25);
    check('top speed sits within 5% of the type\'s', Math.abs(s.speed - p.topSpeed) < p.topSpeed * 0.05, s.speed.toFixed(0));
    check('even levers run straight', Math.abs(s.eng[0].a * 180 / Math.PI) < 1.5, (s.eng[0].a * 180 / Math.PI).toFixed(2));
    check('both cables carry the tow at speed', s.cable.every((c) => c.ok && c.gauge > 10), s.cable.map((c) => c.gauge.toFixed(0)).join('/'));
  }
  {
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 10);
    const h0 = s.eng[0].a;
    drive(s, { left: 1, right: 0 }, 1.5);
    check('more left thrust turns it right', s.eng[0].a - h0 > 0.3, ((s.eng[0].a - h0) * 180 / Math.PI).toFixed(0) + ' deg');
    // Gripping, the pod trails the turn on its tether; it is the slide that hangs it out wide.
    check('in a plain turn the pod trails, close to the line', Math.abs(across(s)) < 0.05, across(s).toFixed(3));
    const w = fresh();
    drive(w, { left: 1, right: 1 }, 10);
    drive(w, { left: 1, right: 1, steer: 1, slide: true }, 1.2);
    check('in a slide the pod swings wide of a right turn', across(w) < -0.02, across(w).toFixed(3));
  }
  {
    // The slingshot: let a slide go with the pod hung out and the turbines take more thrust.
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 8);
    drive(s, { left: 1, right: 1, steer: 1, slide: true }, 1.2);
    const ev = drive(s, { left: 1, right: 1 }, 0.1);
    check('letting a slide go fires the whip', ev.some((e) => e?.type === 'whip') && s.whipT > 0, JSON.stringify(ev));
  }
  {
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 8);
    const before = sep(s);
    let least = before;
    for (let i = 0; i < 120; i++) { stepPodracer(s, { brake: 1 }, p, DT); least = Math.min(least, sep(s)); }
    // The tether's cushion: the pod used to coast up into the turbines every time they slowed.
    check('under the air brakes the pod keeps off the turbines', least > before * 0.7, `${before.toFixed(3)} -> ${least.toFixed(3)}`);
  }
  {
    // A / D: the vanes answer at once and hold a rate, rather than winding up.
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 6);
    const h0 = s.eng[0].a;
    drive(s, { left: 1, right: 1, steer: 1 }, 0.5);
    const a1 = s.eng[0].a - h0;
    drive(s, { left: 1, right: 1, steer: 1 }, 0.5);
    const a2 = s.eng[0].a - h0;
    drive(s, { left: 1, right: 1, steer: 1 }, 0.5);
    const a3 = s.eng[0].a - h0;
    const r1 = (a2 - a1) / 0.5, r2 = (a3 - a2) / 0.5, deg = (r) => (r * 180 / Math.PI).toFixed(0);
    check('D turns it right within half a second', a1 > 0.15, deg(a1) + ' deg');
    check('…and holds a rate rather than winding up', r2 < r1 * 1.3 && r2 < 1.5 && s.binder && s.cable.every((c) => c.ok), deg(r1) + ' then ' + deg(r2) + ' deg/s');
    drive(s, { left: 1, right: 1 }, 2.5);
    check('letting go of D straightens it', Math.abs(s.eng[0].w) < 0.25, deg(s.eng[0].w) + ' deg/s');
  }
  {
    // The power slide turns harder than a plain turn.
    const turn = (slide) => { const s = fresh(); drive(s, { left: 1, right: 1 }, 6); const h0 = s.pod.a; drive(s, { left: 1, right: 1, steer: 1, slide }, 1.5); return s.pod.a - h0; };
    const plain = turn(false), slid = turn(true);
    check('a power slide turns harder than a plain turn', slid > plain * 1.2, (plain * 180 / Math.PI).toFixed(0) + ' vs ' + (slid * 180 / Math.PI).toFixed(0) + ' deg');
  }
  {
    // The boost: faster, and it heats the turbines until they burn.
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 15);
    const top = s.speed;
    let burnt = false;
    for (let i = 0; i < 60 * 8 && !burnt; i++) { stepPodracer(s, { left: 1, right: 1, boost: true }, p, DT); burnt = s.events.some((e) => e?.type === 'overheat'); }
    check('the boost runs past top speed', s.speed > top * 1.1, top.toFixed(0) + ' -> ' + s.speed.toFixed(0));
    check('…and held, a turbine burns', burnt && s.engHp.some((h) => h < 1));
    drive(s, { left: 1, right: 1 }, 6);
    check('off the boost the turbines cool', s.heat.every((h) => h < 0.8), s.heat.map((h) => h.toFixed(2)).join('/'));
  }
  {
    // A yank: the pod loses 150 mph against turbines at full chat.
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 8);
    const v = Math.hypot(s.pod.vx, s.pod.vy), k = Math.max(0, 1 - 150 / p.tileMph / v);
    s.pod.vx *= k; s.pod.vy *= k;
    const ev = drive(s, { left: 1, right: 1 }, 0.5);
    check('a 150 mph yank snaps a cable', ev.some((e) => e?.type === 'snap'));
    // Hard driving does not.
    const h = fresh(); const evh = [];
    evh.push(...drive(h, { left: 1, right: 1 }, 10));
    for (let i = 0; i < 5; i++) { evh.push(...drive(h, { left: 1, right: 0 }, 1.2)); evh.push(...drive(h, { left: 0, right: 1 }, 1.2)); }
    for (let i = 0; i < 3; i++) { evh.push(...drive(h, { brake: 1 }, 0.6)); evh.push(...drive(h, { left: 1, right: 1 }, 1.5)); }
    check('slaloms and brake-and-go never snap a cable', !evh.some((e) => e?.type === 'snap'));
  }
  {
    const s = fresh();
    const ev = drive(s, { left: 1, right: 1, solid: (x, y) => y < -6 }, 10);
    check('a wall at full speed tears the binder out', ev.includes('binder') && !s.binder);
    check('…and the throttle goes with it', s.lever.every((l) => l === 0));
    const slow = fresh();
    const evs = drive(slow, { left: 0.15, right: 0.15, solid: (x, y) => y < -1.5 }, 10);
    check('a slow bump keeps the binder', slow.binder && evs.some((e) => e?.type === 'hit'));
  }
  {
    const a = fresh(), b = fresh();
    drive(a, { left: 1, right: 0.6 }, 4); drive(b, { left: 1, right: 0.6 }, 4);
    check('the same inputs give the same racer', a.x === b.x && a.y === b.y && a.heading === b.heading);
    const c = createPodracerState(p, { docked: false });
    placePodracer(c, p, 5, 7, 90);
    check('placePodracer puts the pod where asked, turbines ahead', c.x === 5 && c.y === 7 && c.eng[0].x > 5);
  }

  // ── The binder and the turbines ─────────────────────────────────────────────
  {
    const span = (s) => Math.hypot(s.eng[0].x - s.eng[1].x, s.eng[0].y - s.eng[1].y) / (2 * p.halfSpan);
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 8);
    s.eng[0].vx += 0.5;
    let most = 0;
    for (let i = 0; i < 12; i++) { stepPodracer(s, { left: 1, right: 1 }, p, DT); most = Math.max(most, Math.abs(span(s) - 1)); }
    check('a knock flexes the binder', most > 0.03, (most * 100).toFixed(1) + '%');
    drive(s, { left: 1, right: 1 }, 1.5);
    check('…and it settles back to the span', s.binder && Math.abs(span(s) - 1) < 0.01, (span(s) * 100).toFixed(1) + '%');
    const b = fresh();
    drive(b, { left: 1, right: 1 }, 3);
    breakBinder(b, p);
    b.eng[0].vx += 1.2;
    let least = 9; const ev = [];
    for (let i = 0; i < 90; i++) { stepPodracer(b, {}, p, DT); ev.push(...b.events); least = Math.min(least, Math.hypot(b.eng[0].x - b.eng[1].x, b.eng[0].y - b.eng[1].y)); }
    check('loose turbines cannot pass through each other', least > 2 * p.engR * 0.95, least.toFixed(3));
    check('…and a clash between them is a hit', ev.some((e) => e?.type === 'hit' && e.part === 'turbines'));
  }

  // ── The envelope ────────────────────────────────────────────────────────────
  {
    const base = { x: 1024, y: 957, at: 1000, hull: 0.8, eng: [0.9, 0.7], fuel: 0.6, cables: [true, false], binder: true, heading: 0 };
    const pkt = (o = {}) => {
      const d = { x: 1024.5, y: 957, h: 90, sp: 120, hull: 0.8, eL: 0.9, eR: 0.7, fuel: 0.6, lL: 1, lR: 1, cab: 3, bind: 1, ex: 1024.8, ey: 957, eh: 90, ...o };
      return [d.x, d.y, d.h, d.sp, d.hull, d.eL, d.eR, d.fuel, d.lL, d.lR, d.cab, d.bind, d.ex, d.ey, d.eh];
    };
    const ok = seat.checkSync(base, pkt(), 1250, p);
    check('a sane report is taken', ok.ok);
    check('a snapped cable stays snapped', ok.ok && ok.rig.cables[1] === false);
    const up = seat.checkSync(base, pkt({ hull: 1, eL: 1, fuel: 1 }), 1250, p);
    check('hull, turbines and fuel never go up', up.ok && up.rig.hull === 0.8 && up.rig.eng[0] === 0.9 && up.rig.fuel === 0.6);
    const jump = seat.checkSync(base, pkt({ x: 1034 }), 1250, p);
    check('a ten-tile jump in a quarter second is refused', !jump.ok && jump.why === 'jump');
    // No box: the test is ground. A report over none is refused; the same report over ground is taken.
    const out = seat.checkSync(base, pkt({ x: 990 }), 1250, p, (x) => (x >= 1000 ? { id: 'ground' } : null));
    check('a report over no ground is refused as the edge', !out.ok && out.why === 'edge');
    const over = seat.checkSync(base, pkt({ x: 1024.5 }), 1250, p, () => ({ id: 'ground' }));
    check('…and the same report over ground is taken', over.ok);
    const far = seat.checkSync(base, pkt({ ex: 1030 }), 1250, p);
    check('the turbines are clamped to the cables', far.ok && Math.hypot(far.rig.ex - far.rig.x, far.rig.ey - far.rig.y) < 0.5);
    const torn = seat.checkSync({ ...base, binder: false }, pkt({ bind: 1 }), 1250, p);
    check('a torn binder stays torn', torn.ok && torn.rig.binder === false);
    const lo = seat.wreckPlan(10, p.topSpeed), hi = seat.wreckPlan(p.topSpeed, p.topSpeed);
    check('a fast wreck throws more and harder strikes than a slow one', hi.hits > lo.hits && hi.max > lo.max);
    // A torn binder is a breakdown: a jolt in the straps, lighter than a wreck, none at a crawl.
    const bLo = seat.breakdownPlan(15, p.topSpeed), bHi = seat.breakdownPlan(p.topSpeed, p.topSpeed);
    check('a torn binder at a crawl costs nothing', bLo.hits === 0);
    check('a torn binder flat out jolts you, but less than a wreck', bHi.hits > 0 && bHi.hits < hi.hits && bHi.max < hi.max);
  }
  {
    // The breakdown, in the model: the turbines cut, will not light, and the yard's weld mends it.
    const s = fresh();
    drive(s, { left: 1, right: 1 }, 4);
    breakBinder(s, p);
    check('a torn binder cuts the turbines', !s.running && !s.binder);
    const ev = drive(s, { starter: true }, 2);
    check('…and they will not light without one', !s.running && ev.includes('nobinder'));
    mendBinder(s, p);
    const ev2 = drive(s, { starter: true }, 2);
    check("the yard's weld puts it back, and it starts", s.binder && s.running && ev2.includes('started'));
    const t = createPodracerState(p);
    tornBinder(t, p);
    check('a racer brought out torn is torn, with nothing lit', !t.binder && !t.running);
    // The yard: a torn binder costs a weld, and survives a climb out and back in on the row.
    const row = { type_id: 'podracer', condition: 1, fuel: 1, custom_data: {} };
    const tornRow = { ...row, custom_data: { binder: false } };
    check('a torn binder is on the service bill', lot.serviceQuote(tornRow).parts > lot.serviceQuote(row).parts);
    check('the row remembers a torn binder', lot.rowBinder(tornRow) === false && lot.rowBinder(row) === true);
  }
  {
    // The three racers: each reaches its own top speed launched, and each is drawn from its own mesh.
    const { variantMeshFor } = await import('../../client/game/js/panels/aircraft3d.js');
    for (const [id, t] of Object.entries(PODRACER_TYPES)) {
      const s = createPodracerState(t, { docked: false }); s.running = true;
      for (let i = 0; i < 60 * 25; i++) stepPodracer(s, { left: 1, right: 1 }, t, DT);
      check(`${t.name} reaches its own top speed`, Math.abs(s.speed - t.topSpeed) < t.topSpeed * 0.05 && s.cable.every((c) => c.ok), s.speed.toFixed(0) + ' of ' + t.topSpeed);
      if (id !== 'podracer') check(`${t.name} is drawn from its own mesh`, variantMeshFor('podracer', id) === 'podracer_' + id, String(variantMeshFor('podracer', id)));
      // Launching from docked, its turbines fly out on the cables and nothing snaps.
      const d = createPodracerState(t); d.running = true;
      for (let i = 0; i < 60 * 8; i++) stepPodracer(d, { left: 1, right: 1 }, t, DT);
      toggleDock(d, t);
      for (let i = 0; i < 60 * 3; i++) stepPodracer(d, { left: 1, right: 1 }, t, DT);
      const gap = Math.hypot((d.eng[0].x + d.eng[1].x) / 2 - d.pod.x, (d.eng[0].y + d.eng[1].y) / 2 - d.pod.y);
      check(`${t.name} launches out to full cable without a snap`, gap > t.cableLen && d.cable.every((c) => c.ok) && d.binder, gap.toFixed(3));
    }
  }
  {
    // Docked and launched. It starts docked, the turbines alongside; F kicks them off on the cables.
    const s = createPodracerState(p); s.running = true;
    const gap = () => Math.hypot((s.eng[0].x + s.eng[1].x) / 2 - s.pod.x, (s.eng[0].y + s.eng[1].y) / 2 - s.pod.y);
    check('it starts docked, the turbines alongside the pod', s.mode === 'docked' && gap() < 0.06, gap().toFixed(3));
    drive(s, { left: 1, right: 1 }, 15);
    check('docked, it tops out at a medium speed', s.speed > 120 && s.speed < 175 && gap() < 0.06, s.speed.toFixed(0) + ' mph');
    const ev = drive(s, { left: 1, right: 1, dockToggle: true }, 1 / 60);
    drive(s, { left: 1, right: 1 }, 3);
    check('F launches them out on the cables, with the binder up', ev.includes('launch') && s.mode === 'launched' && gap() > 0.3 && s.binderPower > 0.8,
      gap().toFixed(3) + ', power ' + s.binderPower.toFixed(2));
    drive(s, { left: 1, right: 1 }, 15);
    check('launched, it runs on to full speed', s.speed > 280, s.speed.toFixed(0) + ' mph');
    const before = s.speed;
    let most = 0;
    toggleDock(s, p);
    for (let i = 0; i < 240; i++) { stepPodracer(s, { left: 1, right: 1 }, p, DT); most = Math.max(most, s.speed); }
    check('F again brings them in alongside, and the pod is not yanked', s.mode === 'docked' && gap() < 0.06 && most < before * 1.03,
      'peak ' + most.toFixed(0) + ' from ' + before.toFixed(0));
    // Launched at a crawl, the binder idles; the faster it goes, the harder it holds.
    const c = fresh();
    drive(c, {}, 2);
    check('launched at a standstill, the binder idles', c.binderPower < 0.2, c.binderPower.toFixed(2));
  }
  {
    // Slow turning: one turbine from a standstill swings the pair round, never back over the pod.
    const s = fresh();
    let least = 9;
    const gap = () => Math.hypot((s.eng[0].x + s.eng[1].x) / 2 - s.pod.x, (s.eng[0].y + s.eng[1].y) / 2 - s.pod.y);
    for (let i = 0; i < 240; i++) { stepPodracer(s, { left: 1, right: 0 }, p, DT); least = Math.min(least, gap()); }
    check('one turbine from rest turns it, but never back over the pod', least > 0.24 && s.binder, least.toFixed(3));
    check('…and the pair stays inside the jackknife limit', (s.jack || 0) < 1.15, (s.jack || 0).toFixed(2));
  }
  {
    // The reversers back it up, slowly, and the pod is pushed back on its cables, not run over.
    const s = fresh();
    drive(s, { reverse: 1 }, 4);
    const fwd = (s.pod.vx * Math.sin(s.pod.a) - s.pod.vy * Math.cos(s.pod.a)) * p.tileMph;
    check('the reversers back it up, slowly', fwd < -6 && fwd > -p.revMph - 2, fwd.toFixed(1) + ' mph');
  }
  {
    // Paint: a scheme, your own colours over what it has, and a refusal that says why.
    const ice = lot.parsePaint(['icewater'], null);
    check('a scheme is a livery', ice.livery && ice.livery.base === '#2f7fd1');
    check('factory paint is no livery', lot.parsePaint(['factory'], ice.livery).livery === null);
    const own = lot.parsePaint(['base=#123456', 'finish=matte'], ice.livery);
    check('your own colours go over what it has', own.livery && own.livery.base === '#123456' && own.livery.trim === '#e8edf2' && own.livery.finish === 'matte');
    check('a colour that is not one is refused', !!lot.parsePaint(['base=red'], null).err);
    check('a livery is named back to its scheme', lot.schemeOfLivery(ice.livery) === 'icewater' && lot.schemeOfLivery(own.livery) === 'custom');
  }
  {
    // The depot standard: the shop is a room you walk into, and the racer comes out of its building's
    // bay door (docs/reference/depot-shell.md).
    const bay = getZone('zone_racerbay_deadleg');
    check('the racer bay is the racer lot, and a room', !!bay?.flags?.podracer_lot && !!bay?.flags?.is_interior);
    check('the open yard is not a shop any more', !getZone('zone_scw_1024_957')?.flags?.podracer_lot);
    const door = getZone(bay?.flags?.world_exit_zone);
    check("the racer bay's building has a drive-through bay door", !!door?.flags?.vehicle_bay && door?.map_id === 'map_world');
    const start = seat.startOf({ park_zone: 'zone_racerbay_deadleg', custom_data: {} });
    check('a racer in the bay starts on the bay door, facing out of it',
      !!start && start.x === door?.grid_x && start.y === door?.grid_y && start.heading === 180, JSON.stringify(start));
    check('a racer stopped on the bay door is back at its lot', seat.bayLotAt(door?.grid_x + 0.2, door?.grid_y - 0.1) === 'zone_racerbay_deadleg');
    check('a racer stopped at the yard leaves you in the yard', seat.standTileNear(1024.2, 957.1) === 'zone_scw_1024_957');
    rigs.set('regress_pod', { playerId: 'regress_pod', x: 1024, y: 957, heading: 10, speed: 50, ex: 1024, ey: 956.6, eh: 10, cables: [true, true], binder: true, lever: [1, 1] });
    const near = idx.racerContactsNear(1024, 957, 26);
    check('a running racer is published as a contact', near.some((c) => c.id === 'pod_regress_pod' && c.cls === 'podracer' && c.podracer?.binder && c.podracer.L.dy < 0));
    rigs.delete('regress_pod');
  }

  // ── The text helm ───────────────────────────────────────────────────────────
  //
  // The textgames and log rungs drive the same model by `pod` orders (texthelm.js). Driven here on an
  // open flat (`ground`), so the numbers are the model's and not whatever stands south of the shed.
  {
    const row = { id: 'regress_text_pod', type_id: 'podracer', condition: 1, fuel: 1, custom_data: {} };
    const flat = { solid: () => false, surface: () => 'redrock' };
    const who = { id: 'regress_text_pod_driver' };
    const order = (r, words) => { text.runs.set(who.id, r); return cmdPod(words.split(' ').slice(1), words, who); };
    const go = (r, secs) => { const ev = []; for (let t = 0; t < secs; t += 1) ev.push(...text.stepRun(r, Math.min(1, secs - t))); return ev; };
    const fwdOf = (s) => (s.pod.vx * Math.sin(s.pod.a) - s.pod.vy * Math.cos(s.pod.a)) * p.tileMph;
    try {
      const r = text.makeRun(row, { x: 0, y: 0, heading: 0 }, { ground: flat });
      check('a text racer comes out cold and docked', !r.s.running && r.s.mode === 'docked');
      const cold = await order(r, 'pod full');
      check('pod full with the turbines cold says to start them', cold?.type === 'error' && /pod start/.test(cold.message));
      await order(r, 'pod start');
      const lit = go(r, 2);
      check('pod start cranks and lights the turbines', r.s.running && lit.includes('started'));
      await order(r, 'pod full');
      go(r, 15);
      check('pod full, docked, tops out where the seat does', r.s.speed > 120 && r.s.speed < 175, r.s.speed.toFixed(0) + ' mph');
      check('…burning fuel through the shared burn', r.fuel < 1 && r.fuel > 0.9, r.fuel.toFixed(3));
      await order(r, 'pod launch');
      go(r, 20);
      check('pod launch runs it on to the type\'s top speed', r.s.mode === 'launched' && Math.abs(r.s.speed - p.topSpeed) < p.topSpeed * 0.05,
        r.s.speed.toFixed(0) + ' of ' + p.topSpeed);
      // A heading: flown to through the vanes and held, not swung through.
      await order(r, 'pod 90');
      let most = 0;
      for (let t = 0; t < 8; t++) {
        text.stepRun(r, 1);
        const h = Math.atan2(Math.sin(r.s.eng[0].a) + Math.sin(r.s.eng[1].a), Math.cos(r.s.eng[0].a) + Math.cos(r.s.eng[1].a)) * 180 / Math.PI;
        most = Math.max(most, h);
      }
      const h = ((Math.atan2(Math.sin(r.s.eng[0].a) + Math.sin(r.s.eng[1].a), Math.cos(r.s.eng[0].a) + Math.cos(r.s.eng[1].a)) * 180 / Math.PI) + 360) % 360;
      check('pod 90 comes round onto 90 and holds it', Math.abs(h - 90) < 4 && r.s.binder && r.s.cable.every((c) => c.ok), h.toFixed(1));
      check('…without swinging far through it', most < 100, most.toFixed(1));
      check('pod west is a heading too', (await order(r, 'pod west'))?.type === 'emote' && r.want.bearing === 270);
      await order(r, 'pod 90');
      // The slide, armed for one turn: let go when the turn is done, and the whip fires.
      await order(r, 'pod slide');
      await order(r, 'pod right 90');
      const slid = go(r, 5);
      check('pod slide hangs it out through the next turn and whips it back', slid.some((e) => e?.type === 'whip') && !r.want.slide);
      await order(r, 'pod brake');
      go(r, 40);
      check('pod brake brings it to a stop and lets go', r.s.speed < 2.5 && !r.want.brake, r.s.speed.toFixed(1));
      await order(r, 'pod reverse');
      go(r, 4);
      check('pod reverse backs it up from a standstill', fwdOf(r.s) < -3 && fwdOf(r.s) > -p.revMph - 2, fwdOf(r.s).toFixed(1));
      check('the status line reads the dials', /mph/.test(text.statusLine(r)) && /fuel \d+%/.test(text.statusLine(r)));
      check('a nonsense order is refused with the orders', (await order(r, 'pod frobnicate'))?.type === 'error');
      const killed = await order(r, 'pod kill');
      check('pod kill shuts the turbines down', !r.s.running && killed?.type === 'emote');

      // Dry: the levers go dead, as on the seat.
      const d = text.makeRun(row, { x: 0, y: 0, heading: 0 }, { ground: flat });
      await order(d, 'pod start'); go(d, 2); await order(d, 'pod full');
      d.fuel = 0.0005;
      go(d, 5);
      check('a text racer that runs dry loses its levers', d.fuel === 0 && d.s.lever.every((l) => l === 0));

      // A wall at full stretch: the same tear, and the run stops stepping at it for the seat's breakdown.
      const w = text.makeRun(row, { x: 0, y: 0, heading: 0 }, { ground: { solid: (x, y) => y < -12, surface: () => 'redrock' } });
      await order(w, 'pod start'); go(w, 2); await order(w, 'pod full'); await order(w, 'pod launch');
      const hit = go(w, 20);
      check('driven by text into a wall flat out, the binder tears', hit.includes('binder') && !w.s.binder);

      // The real ground: the rule is the seat's map window's.
      check('the open waste beyond every region is solid', text.solidAt(-5000, -5000));
      const bay = getZone('zone_racerbay_deadleg');
      const door = getZone(bay?.flags?.world_exit_zone);
      check('the shed\'s bay door is not solid to a racer', door && !text.solidAt(door.grid_x, door.grid_y));
      const out = text.makeRun(row, { x: door?.grid_x, y: door?.grid_y, heading: 180 });
      check('pod look names the way to the shed door', /shed door/.test(text.lookLine(out)), text.lookLine(out).slice(0, 120));
    } finally { text.runs.delete(who.id); }
  }
  {
    // Seated at a text rung: the seat starts a text run rather than refusing, and is a contact.
    const pl = getPlayer();
    const saved = await displayRung(pl);
    const row = { id: 'regress_text_pod_row', type_id: 'podracer', owner_id: pl.id, park_zone: 'zone_racerbay_deadleg', condition: 1, fuel: 1, custom_data: {} };
    try {
      const none = await run('pod');
      check('pod outside a racer says how to get in one', none?.type === 'error' && /podracer/.test(none.message));
      await setDisplayRung(pl, 'log');
      const m = await mountRacer(pl, row);
      check('a log-rung player is seated, not refused', m?.type === 'emote' && /pod start/.test(m.message) && text.runs.has(pl.id), m?.message?.slice(0, 80));
      check('…on the log rung\'s pace', text.runs.get(pl.id)?.rung === 'log');
      const rg = rigs.get(pl.id);
      check('…and the text racer is published like any other', !!rg && idx.racerContactsNear(rg.x, rg.y, 5).some((c) => c.id === 'pod_' + pl.id));
      const st = await run('pod start');
      check('pod start answers from the seat', st?.type === 'emote', st?.message?.slice(0, 80));
      // The real tick, with its narration: two seconds of it light the turbines in the shed door.
      text.runs.get(pl.id).last -= 2000;
      await text.tick();
      check('the tick runs the seated text racer on', text.runs.get(pl.id)?.s.running === true && rigs.get(pl.id)?.at > 0);
      const look = await run('pod look');
      check('pod look answers from the shed door', /shed door/.test(look?.message || ''), look?.message?.slice(0, 80));
      await setDisplayRung(pl, 'textgames');
      await dropSeat(pl.id);
      check('dropping the seat ends the text run', !text.runs.has(pl.id) && !rigs.has(pl.id));
      const m2 = await mountRacer(pl, row);
      check('a textgames player is seated on the textgames pace', m2?.type === 'emote' && text.runs.get(pl.id)?.rung === 'textgames');
      await run('pod park');
      check('pod park climbs out and ends the run', !text.runs.has(pl.id) && !seated.has(pl.id));
    } finally {
      await dropSeat(pl.id);
      if (saved) await setDisplayRung(pl, saved);
      else { await setFlag('player', DISPLAY_MODE_FLAG, '', pl).catch(() => {}); pl.displayRung = undefined; }
    }
  }

  // ── Off the rim and onto the highway ────────────────────────────────────────
  //
  // No vehicle is confined by an invisible fence. A racer driven off the Scarletwastes at a road
  // mouth joins the void corridor the trucks drive, through trucking's own leg code: the crossing is
  // launched under it, its map and ground come from the road, the odometer and the room derive from
  // the position, and parking out there leaves you in the crossing room with the racer parked in it.
  {
    const pl = getPlayer();
    const KEY = 'region_scarletwastes';
    const gates = regionGates(KEY);
    // The west mouth, toward Coldwater: the one with the smallest x.
    const gate = gates.length ? gates.reduce((a, b) => (b.x < a.x ? b : a)) : null;
    const off = gate && [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ x: gate.x + dx, y: gate.y + dy, h: dx < 0 ? 270 : dx > 0 ? 90 : dy < 0 ? 0 : 180 }))
      .find((t) => !surfaceAt(t.x, t.y));
    check('the Scarletwastes publishes a road mouth with open waste past it', !!gate && !!off, JSON.stringify({ gate, off }));
    if (gate && off) {
      voidTest.setWindow(2900);
      voidTest.setEncounters(false);
      const id = 'pod_regress_corridor';
      const zone0 = pl.current_zone;
      const pkt = (x, y, h, sp) => `podsync ${x} ${y} ${h} ${sp} 1 1 1 1 1 1 3 1 ${x} ${y} ${h}`;
      let inst = null;
      try {
        await query('DELETE FROM podracers WHERE id = $1', [id]);
        await query(`INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
          VALUES ($1, 'podracer', 'Regress Racer', $2, $3, 1, 1, '{}'::jsonb)`, [id, pl.id, gate.id]);
        const row = (await query('SELECT * FROM podracers WHERE id = $1', [id])).rows[0];
        // Standing on the rim tile the racer is parked on, with no muster or crossing left over from
        // another suite (the trucking suite's own note on this).
        removePlayerFromZone(pl.id, pl.current_zone);
        pl.current_zone = gate.id; addPlayerToZone(pl.id, gate.id);
        setLivePlayer(pl.id, pl);
        delete pl._crossing;
        voidTest.playerStaging.delete(pl.id);
        for (const [sid, st] of voidTest.stagings) if (st.leaderId === pl.id) voidTest.stagings.delete(sid);

        await mountRacer(pl, row);
        const rig = rigs.get(pl.id);
        check('a racer parked on the rim tile is mounted, on the city leg', seated.get(pl.id) === id && rig?.leg === 'city', rig?.leg);
        check('…and the approach already has the highway past the rim in its ground',
          !!seat.groundFor(rig)(off.x, off.y) && !surfaceAt(off.x, off.y));

        // Drive off the rim: one tile past it, where the placed map ends and the road does not.
        rig.at = Date.now() - 500;
        await run(pkt(off.x, off.y, off.h, 60));
        const r1 = rigs.get(pl.id);
        check('driving off the rim starts a crossing', !!pl._crossing);
        check('…and the racer is on the corridor leg with a road and a chain', r1?.leg === 'corridor' && !!r1.route && r1.chain?.length > 0, r1?.leg);
        check('…standing in the first room of it', !!r1?.chain && r1.chain[0] === pl.current_zone, pl.current_zone);
        check('…where it reported, not snapped back to the gate', !!r1 && Math.hypot(r1.x - off.x, r1.y - off.y) < 0.01, `${r1?.x},${r1?.y}`);
        inst = pl._crossing && voidTest.crossings.get(pl._crossing.instanceId);

        // A corridor report: six tiles down the road. The odometer is derived from the position.
        if (r1?.route) {
          const p6 = corridorPos(r1.route, 6, 0);
          r1.at = Date.now() - 2000;
          await run(pkt(p6.x.toFixed(3), p6.y.toFixed(3), p6.heading, 120));
          const r2 = rigs.get(pl.id);
          check('a corridor report is taken, with no box to refuse it', !!r2 && Math.hypot(r2.x - p6.x, r2.y - p6.y) < 0.01, `${r2?.x},${r2?.y}`);
          check('…and the odometer is derived from the position', !!r2 && Math.abs(r2.s - 6) < 0.6, r2?.s);
          check('…in the room the odometer says', !!r2?.chain && pl.current_zone === r2.chain[r2.node], `${pl.current_zone} vs ${r2?.chain?.[r2?.node]}`);
          const win = mapWindow({ grid_x: Math.round(p6.x), grid_y: Math.round(p6.y) }, 1, seat.groundFor(r2));
          check('…with its map window drawn from the road', win[1][1].kind !== 'air' && !!win[1][1].road, JSON.stringify(win[1][1]).slice(0, 80));
          check('the text helm sees tarmac there, not the edge of the waste',
            !text.solidAt(p6.x, p6.y, seat.groundFor(r2)) && text.groundAt(p6.x, p6.y, seat.groundFor(r2)) === 'road');

          // A report that crosses several rooms at once (a racer at speed, a tab that stalled): every
          // room between is walked, so the crossing's window keeps up and nobody is thrown out.
          const rl = roomLenOf(r2.route), hop = Math.min(6, Math.floor(13 / rl));
          if (hop >= 4) {
            const pT = corridorPos(r2.route, 6 + hop * rl + 0.1, 0);
            r2.at = Date.now() - 3000;
            await run(pkt(pT.x.toFixed(3), pT.y.toFixed(3), pT.heading, 120));
            const r2b = rigs.get(pl.id);
            check(`a report ${hop} rooms on walks every room between and keeps the seat`,
              seated.has(pl.id) && !!r2b?.chain && r2b.node === nodeAt(r2b.route, r2b.s, r2b.chain.length) && pl.current_zone === r2b.chain[r2b.node],
              `node ${r2b?.node} s ${r2b?.s?.toFixed(1)} in ${pl.current_zone}`);
          }

          // Taking the fork with the wheels. The two roads share a different length of tarmac than the
          // crossing has shared rooms, so the odometer can have you in the old limb's rooms while you
          // are still on shared pavement; the first room of the new limb is then far away in the
          // crossing graph and not made. walkToNode backs you down to the trunk and up the new limb.
          // This is the case that climbed a racer out at the Reach turn-off with the fork message.
          {
            const r0 = rigs.get(pl.id);
            const other = r0?.route?.branches?.[0];
            if (other?.route?.trunkL > 8) {
              const tl = other.route.trunkL;
              let ok = true;
              for (let s = Math.max(9, r0.s + 3); s < tl - 2 && ok; s += 3) {
                const q = corridorPos(r0.route, s, 0);
                rigs.get(pl.id).at = Date.now() - 1000;
                await run(pkt(q.x.toFixed(3), q.y.toFixed(3), q.heading, 120));
                ok = seated.has(pl.id);
              }
              check('the trunk is driven up to the turn-off without losing the seat', ok);
              const q = corridorPos(other.route, tl + 1, 0);
              rigs.get(pl.id).at = Date.now() - 3000;
              await run(pkt(q.x.toFixed(3), q.y.toFixed(3), q.heading, 120));
              const rf = rigs.get(pl.id);
              check(`steering onto the ${other.key} limb takes it and keeps the seat`,
                seated.has(pl.id) && rf?.destKey === other.key, `${rf?.destKey} seated=${seated.has(pl.id)}`);
              check('…standing in the new limb\'s room the odometer says',
                !!rf?.chain && pl.current_zone === rf.chain[rf.node], `${pl.current_zone} vs ${rf?.chain?.[rf?.node]}`);
            }
          }

          // Park out here: you are left in the crossing room and the racer is parked in it.
          const room = pl.current_zone;
          const cur = rigs.get(pl.id);
          cur.speed = 0;
          const parked = await run('podevent park');
          check('parking on the corridor leaves you in the crossing room', pl.current_zone === room && !seated.has(pl.id), parked?.message?.slice(0, 60));
          const after = (await query('SELECT park_zone FROM podracers WHERE id = $1', [id])).rows[0];
          check('…and the racer is parked in that room', after?.park_zone === room, after?.park_zone);

          // Back in from the room: the racer goes back onto the road where it was left.
          await mountRacer(pl, { ...row, park_zone: room });
          const r3 = rigs.get(pl.id);
          check('climbing back in from the crossing room puts it on the road there', r3?.leg === 'corridor' && pl.current_zone === room, r3?.leg);
          await dropSeat(pl.id);
        }

        // The crossing ends with the racer parked in it: it goes back to the rim tile.
        if (inst) {
          voidTest.teardownInstance(inst);
          inst = null;
          let home = null;
          for (let i = 0; i < 40 && home !== gate.id; i++) {
            await new Promise((r) => setTimeout(r, 50));
            home = (await query('SELECT park_zone FROM podracers WHERE id = $1', [id])).rows[0]?.park_zone;
          }
          check('a crossing torn down with a racer parked in it sends the racer back to the rim', home === gate.id, home);
        }
      } finally {
        await dropSeat(pl.id);
        if (inst && voidTest.crossings.has(inst.id)) voidTest.teardownInstance(inst);
        delete pl._crossing;
        voidTest.setEncounters(true);
        voidTest.setWindow(null);
        await query('DELETE FROM podracers WHERE id = $1', [id]).catch(() => {});
        removePlayerFromZone(pl.id, pl.current_zone);
        pl.current_zone = zone0; addPlayerToZone(pl.id, zone0);
        setLivePlayer(pl.id, pl);
        await query('UPDATE players SET current_zone = $1 WHERE id = $2', [zone0, pl.id]).catch(() => {});
      }
    }
  }

  // ── Parked in any shed ──────────────────────────────────────────────────────
  //
  // Every truck depot's bay room keeps racers too (lot.js isGarage): drive one into the shed door,
  // park it, and it is there to take out again, though nothing there sells, services or paints one.
  {
    const SHED = 'zone_yard_dryrun';
    const shed = getZone(SHED);
    const door = getZone(shed?.flags?.world_exit_zone);
    check('a truck shed is a garage for racers, and not a racer lot', lot.isGarage(shed) && !lot.isLot(shed));
    check("a racer stopped on a truck shed's door parks in that shed", !!door && seat.bayLotAt(door.grid_x, door.grid_y) === SHED);
    const start = seat.startOf({ park_zone: SHED, custom_data: {} });
    check('…and comes out of the same door, facing out', !!start && start.x === door?.grid_x && start.y === door?.grid_y && start.heading === 180, JSON.stringify(start));
    check('…and climbing out there leaves you in the shed',
      seat.restingZone({ park_zone: 'zone_scw_1024_957' }, { x: door?.grid_x, y: door?.grid_y }).zoneId === SHED);
    const dl = getZone('zone_yard_deadleg');
    const dlDoor = getZone(dl?.flags?.world_exit_zone);
    check("the Deadleg's shared door still parks a racer in the racer bay", seat.bayLotAt(dlDoor?.grid_x, dlDoor?.grid_y) === 'zone_racerbay_deadleg');
    check('a racer with no home still goes to a racer bay', lot.isLot(getZone(homeLot())), homeLot());

    const pl = getPlayer();
    const id = 'pod_regress_shed';
    const zone0 = pl.current_zone, cr0 = pl.credits;
    try {
      await query('DELETE FROM podracers WHERE id = $1', [id]);
      await query(`INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
        VALUES ($1, 'skitter', 'Regress Shed Racer', $2, $3, 1, 1, '{}'::jsonb)`, [id, pl.id, SHED]);
      pl.current_zone = SHED; pl.credits = 0;
      const panel = await lot.racerPanel(pl, SHED);
      check("the bay overlay's payload in a truck shed sells nothing", panel?.sells === false && panel.fleet.some((r) => r.id === id && r.inYard));
      check('the racer counter is not dealt standing in a truck shed', (await idx.pushDepot(pl)) === false);
      const cards = await lot.parkedCards(pl, [SHED, shed.flags.truck_depot.yard, door?.id]);
      check("the truck counter's hook deals the racer as a card that seats you",
        cards.length === 1 && cards[0].cmd === `podracer take ${id}` && cards[0].v?.cls === 'podracer', JSON.stringify(cards[0])?.slice(0, 120));
      const yard = await run('yard text');
      check("the truck yard's written counter lists it under the shed", /ALSO IN THE SHED/.test(yard?.message || '') && (yard?.message || '').includes('Regress Shed Racer'), yard?.message?.slice(0, 120));
      check('podracer finds it parked in the shed', (await lot.racerHere(pl))?.id === id);
      const buy = await run('podracer buy');
      check('…but the truck shed sells no racers', /racer bay at the Deadleg/.test(buy?.message || ''), buy?.message?.slice(0, 80));
    } finally {
      await query('DELETE FROM podracers WHERE id = $1', [id]).catch(() => {});
      pl.current_zone = zone0; pl.credits = cr0;
    }
  }

  // ── Somebody else's, left on a tile ─────────────────────────────────────────
  //
  // Parked on an open tile, the owner can always climb in and anybody else only if it is unlocked
  // (server/engine/vehicle-access.js). Parking locks it; `unlock` beside it leaves it open.
  {
    const pl = getPlayer();
    const TILE = seat.standTileNear(1022.2, 960.1);
    const OTHER = 'regress_other_owner';
    const id = 'pod_regress_theirs', mineId = 'pod_regress_mine_tile';
    const zone0 = pl.current_zone;
    check('an open tile to leave a racer on', !!TILE && access.isOpenTile(TILE), TILE);
    check('a truck shed is not an open tile', !access.isOpenTile('zone_yard_dryrun'));
    check('the owner may board a locked vehicle', access.boardCheck(pl, { ownerId: pl.id, cd: { locked: true }, zoneId: TILE }).ok);
    check('a stranger may not board a locked one', !access.boardCheck(pl, { ownerId: OTHER, cd: {}, zoneId: TILE }).ok);
    check('…but may an unlocked one on an open tile', access.boardCheck(pl, { ownerId: OTHER, cd: { locked: false }, zoneId: TILE }).ok);
    check('…and never one inside a depot', !access.boardCheck(pl, { ownerId: OTHER, cd: { locked: false }, zoneId: 'zone_yard_dryrun' }).ok);
    try {
      await query('DELETE FROM podracers WHERE id = ANY($1)', [[id, mineId]]);
      await query(`INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
        VALUES ($1, 'skitter', 'Their Racer', $2, $3, 1, 1, '{"locked": true}'::jsonb)`, [id, OTHER, TILE]);
      pl.current_zone = TILE;
      const locked = await run('podracer');
      check('podracer refuses somebody else\'s locked racer', /locked/i.test(locked?.message || '') && !seated.has(pl.id), locked?.message?.slice(0, 80));
      await query(`UPDATE podracers SET custom_data = '{"locked": false}'::jsonb WHERE id = $1`, [id]);
      check('…and finds it once it is unlocked', (await lot.racerHere(pl, null, { strangers: true }))?.id === id);
      check('…though no verb but climbing in treats it as yours', (await lot.racerHere(pl)) === null);
      noteRacerParked({ id, name: 'Their Racer', owner_id: OTHER, type_id: 'skitter' }, TILE, false);
      check('the room says it is parked here, unlocked, with the way in', /Parked here:.*Their Racer.*unlocked/.test(access.parkedLine(TILE, pl)) && access.parkedLine(TILE, pl).includes(`podracer take ${id}`));
      check('…and a locked one of somebody else\'s carries no way in', (noteRacerParked({ id, name: 'Their Racer', owner_id: OTHER }, TILE, true), !access.parkedLine(TILE, pl).includes('data-cmd')));
      // Your own, and the latch from outside.
      await query(`INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
        VALUES ($1, 'skitter', 'Mine On The Tile', $2, $3, 1, 1, '{}'::jsonb)`, [mineId, pl.id, TILE]);
      noteRacerParked({ id: mineId, name: 'Mine On The Tile', owner_id: pl.id }, TILE, true);
      const un = await run('unlock racer');
      const cd = (await query('SELECT custom_data FROM podracers WHERE id = $1', [mineId])).rows[0]?.custom_data;
      check('unlock beside your own racer leaves it open', /unlocked/.test(un?.message || '') && cd?.locked === false, un?.message?.slice(0, 80));
      const lk = await run('lock racer');
      const cd2 = (await query('SELECT custom_data FROM podracers WHERE id = $1', [mineId])).rows[0]?.custom_data;
      check('…and lock shuts it again', cd2?.locked === true, lk?.message?.slice(0, 80));
      check('nobody can unlock somebody else\'s', !(await lot.setRacerLocked(id, pl.id, false)));
    } finally {
      await query('DELETE FROM podracers WHERE id = ANY($1)', [[id, mineId]]).catch(() => {});
      access.noteGone('racer', id); access.noteGone('racer', mineId);
      pl.current_zone = zone0;
    }
  }

  // ── The verbs ───────────────────────────────────────────────────────────────
  {
    const pl = getPlayer();
    const r = await run('podracers');
    check('podracers answers', r && r.type !== 'error' && /racer/i.test(r.message || ''), r?.message?.slice(0, 80));
    const here = await run('podracer');
    check('podracer away from the lot with nothing parked says so', /no racer parked here|DEADLEG/i.test(here?.message || ''), here?.message?.slice(0, 80));
    // At the lot with no money: the price and a refusal, and nothing written.
    const zone0 = pl.current_zone, cr0 = pl.credits;
    pl.current_zone = 'zone_racerbay_deadleg'; pl.credits = 0;
    try {
      const stock = await run('podracer');
      check('podracer at the lot lists the stock', /Rasp Twinspool/.test(stock?.message || ''), stock?.message?.slice(0, 80));
      const buy = await run('podracer buy');
      // A bare `buy` takes the first racer in the bay, so the price is read off it, not written here.
      const first = Object.values(PODRACER_TYPES)[0].price.toLocaleString('en-US');
      check('podracer buy with no money refuses with the price', (buy?.message || '').includes(first) && /You have/.test(buy?.message || ''), buy?.message?.slice(0, 80));
      const hire = await run('podracer hire');
      check('podracer hire with no money refuses with the fee', /You have/.test(hire?.message || ''), hire?.message?.slice(0, 80));
      const panel = await lot.racerPanel(pl, 'zone_racerbay_deadleg');
      check("the counter's payload is dealt in the bay, with stock and a hire line",
        panel?.type === 'podracer_depot' && panel.stock.length > 0 && panel.rentStock.length > 0, JSON.stringify(panel)?.slice(0, 120));
      check('…and nowhere else', (await lot.racerPanel(pl, 'zone_scw_1024_957')) === null);
    } finally { pl.current_zone = zone0; pl.credits = cr0; }
    const sync = await run('podsync 1 2 3');
    check('podsync from somebody not seated is silent', sync == null || sync?.type !== 'error');
  }

  // ── The kit ─────────────────────────────────────────────────────────────────
  {
    const stock = podracerTuned('podracer', {});
    check('a stock kit is the type row, its drag solved to the same top speed', stock.topSpeed === p.topSpeed && Math.abs(stock.dragE - p.dragE) < 1e-12);
    check('a kit of nonsense is a stock kit', JSON.stringify(cleanKit({ engine: 9, shell: 'paper', bogus: 1, boost: 0, arc: 'blue' })) === '{}');
    // Flat out on open ground for half a minute, launched: the turbine tune's top speed is reached.
    const flatOut = (q) => { const s = createPodracerState(q, { docked: false }); s.running = true; for (let i = 0; i < 1800; i++) stepPodracer(s, { left: 1, right: 1, fuel: 1 }, q, DT); return s.speed; };
    const pro = podracerTuned('podracer', { engine: 3 });
    const v0 = flatOut(stock), v3 = flatOut(pro);
    check('a pro turbine tune goes faster flat out, near its own top speed', v3 > v0 + 25 && Math.abs(v3 - pro.topSpeed) < pro.topSpeed * 0.05, `${v0.toFixed(0)} → ${v3.toFixed(0)} of ${pro.topSpeed.toFixed(0)}`);
    check('…and it drinks for it', pro.burn > stock.burn && pro.heatUp > stock.heatUp);
    // An armoured pod takes less from the same knock; a lightened one more. Docked, flat out, into a
    // post only the pod's nose meets: the turbines either side of it pass clear.
    const knock = (q) => { const s = createPodracerState(q); s.running = true; placePodracer(s, q, 0, 0, 0);
      for (let i = 0; i < 400; i++) stepPodracer(s, { left: 1, right: 1, fuel: 1, solid: (x, y) => Math.abs(x) < 0.03 && y < -2.5 }, q, DT); return s.hull; };
    const hS = knock(stock), hA = knock(podracerTuned('podracer', { shell: 'armour' })), hL = knock(podracerTuned('podracer', { shell: 'light' }));
    check('an armoured shell takes less from a wall, a lightened one more', hA > hS && hL < hS, `armour ${hA.toFixed(3)} · stock ${hS.toFixed(3)} · light ${hL.toFixed(3)}`);
    const longer = podracerTuned('podracer', { tether: 'long' }), shorter = podracerTuned('podracer', { tether: 'short' });
    check('the tether choices change the cable length both ways', longer.cableLen > p.cableLen && shorter.cableLen < p.cableLen);

    // The envelope reads the tuned row: a report at the pro tune's speed is taken, not called a jump.
    const base = { x: 1024, y: 957, at: 1000, hull: 1, eng: [1, 1], fuel: 1, cables: [true, true], binder: true, heading: 0 };
    // Two seconds between reports, so the tile of slack is small beside the distance.
    const hot = podracerTuned('podracer', { engine: 3, boost: 3 });
    const tiles = (envelopeMph(hot) / hot.tileMph) * 2 * 1.5 + 1 - 0.5, stockReach = (p.topSpeed / p.tileMph) * 2 * 1.5 + 1;
    const pk = [1024 + tiles, 957, 90, 400, 1, 1, 1, 1, 1, 1, 3, 1, 1024 + tiles + 0.3, 957, 90];
    check('the envelope takes a tuned racer at its own top end', seat.checkSync(base, pk, 3000, hot, () => ({ id: 'g' })).ok);
    check('…which it refuses from a stock one', tiles > stockReach && !seat.checkSync(base, pk, 3000, p, () => ({ id: 'g' })).ok, `${tiles.toFixed(1)} vs ${stockReach.toFixed(1)}`);

    // The fitting shop's sums: the difference to go up, part exchange less labour to come down.
    const up = lot.fitQuote(p, {}, { engine: 2 }), down = lot.fitQuote(p, { engine: 2 }, {});
    check('fitting a part costs its share and a labour charge', up.total === Math.round(PODRACER_KIT.engine.cost[2] * p.price) + up.labour && up.labour > 0, JSON.stringify(up));
    check('…and taking it off gives part exchange back, less the labour', down.total < 0 && down.back === Math.round(PODRACER_KIT.engine.cost[2] * p.price * PART_EXCHANGE), JSON.stringify(down));
    check('the verb reads words and numbers for a tier', JSON.stringify(lot.parseKit(['engine=race', 'boost=3', 'shell=armour'], {}).kit) === JSON.stringify({ engine: 2, boost: 3, shell: 'armour' }));
    check('…and refuses a slot it does not know', !!lot.parseKit(['warp=9'], {}).err);
    check('…and stock takes it all off', JSON.stringify(lot.parseKit(['stock'], { engine: 3, arc: 'red' }).kit) === '{}');

    // The looks: each bolt-on opens its own channel and hides the stock part it replaces.
    const look = podracerLook({ spinner: 'spike', fins: 'tall', pipes: 'long', arc: 'green', casing: 'gold' });
    check('a look opens its part and hides the stock one', look.anim.kit_spike && look.anim.kit_spinner && look.anim.kit_fins_tall && look.anim.kit_fin && look.anim.kit_pipes);
    check('…and carries the arc colour and the casing as a paint slot', look.arc?.[1] === 255 && podracerLivery(null, { casing: 'gold' })?.parts?.casing === '#c8a24a');
    check('a stock racer opens no kit channel', Object.keys(podracerLook({}).anim).length === 0);
    // Every channel a kit can open is drawn by at least one face in every racer's mesh.
    const chans = new Set(Object.values(PODRACER_KIT).filter((s) => s.kind === 'look').flatMap((s) => Object.values(s.choices).flatMap((c) => [c.ch, c.hide]).filter(Boolean)));
    for (const id of ['podracer', 'podracer_skitter', 'podracer_sledge']) {
      const faces = compileMesh(MESH_ROWS[id] || {}, { detail: 1 }).faces;
      const seen = new Set(faces.flatMap((f) => [f.when, f.whenNot]).filter(Boolean));
      const missing = [...chans].filter((c) => !seen.has(c));
      check(`${id}: every kit channel has faces`, !missing.length, missing.join(', '));
      // Docked, the latch blades bridge the gap to the turbines; they rest stowed (cards, launched).
      const blades = faces.filter((f) => f.anim?.ch === 'podStow');
      check(`${id}: has latch blades on podStow, stowed at rest`, blades.length > 0 && blades.every((f) => f.anim.def === 1 && f.anim.slide?.[1] !== 0), String(blades.length));
    }

    // The verb, at the counter with no money: the menu, then a refusal with the price, nothing written.
    const pl = getPlayer();
    const id = 'pod_regress_kit';
    const zone0 = pl.current_zone, cr0 = pl.credits;
    // Credits are charged on the players row, which the harness player does not have: one is made
    // for the paid fit and taken away again (the flight suite's setBalance).
    const had = (await query('SELECT credits FROM players WHERE id = $1', [pl.id])).rows[0] || null;
    try {
      await query('DELETE FROM podracers WHERE id = $1', [id]);
      await query(`INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
        VALUES ($1, 'podracer', 'Regress Kit Racer', $2, 'zone_racerbay_deadleg', 1, 1, '{}'::jsonb)`, [id, pl.id]);
      pl.current_zone = 'zone_racerbay_deadleg'; pl.credits = 0;
      const menu = await run(`podracer fit ${id}`);
      check('podracer fit bare is the fitting shop menu', /FITTING SHOP/.test(menu?.message || '') && /engine/.test(menu?.message || ''), menu?.message?.slice(0, 80));
      const broke = await run(`podracer fit ${id} engine=pro`);
      check('…and a part you cannot pay for is refused with the bill', /wants/.test(broke?.message || '') && /You have/.test(broke?.message || ''), broke?.message?.slice(0, 100));
      if (had) await query('UPDATE players SET credits = 100000 WHERE id = $1', [pl.id]);
      else await query("INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1, $1, 'x', $1, 100000)", [pl.id]);
      pl.credits = 100000;
      const fit = await run(`podracer fit ${id} engine=2 arc=violet shell=armour`);
      const row = (await query('SELECT custom_data FROM podracers WHERE id = $1', [id])).rows[0];
      check('a fit is paid for and stored on the row', /fitting shop/i.test(fit?.message || '') && row?.custom_data?.kit?.engine === 2 && row.custom_data.kit.arc === 'violet' && pl.credits < 100000, fit?.message?.slice(0, 100));
      const panel = await lot.racerPanel(pl, 'zone_racerbay_deadleg');
      const card = panel?.fleet?.find((x) => x.id === id);
      check("the counter's card carries the kit and what it is worth", card?.kit?.shell === 'armour' && card.kitWorth > 0);
      check('…and a fitted racer sells for more than a stock one', card.resale > Math.round(p.price * lot.RESALE));
      const ctx = seatContext({ id, type_id: 'podracer', condition: 1, fuel: 1, custom_data: row.custom_data }, { x: 1024, y: 957, heading: 0 }, pl.id);
      check('the seat is handed the tuned row and the kit', ctx.params.topSpeed > p.topSpeed * 1.05 && ctx.kit.engine === 2, `${ctx.params.topSpeed}`);
    } finally {
      await query('DELETE FROM podracers WHERE id = $1', [id]).catch(() => {});
      if (had) await query('UPDATE players SET credits = $2 WHERE id = $1', [pl.id, had.credits]).catch(() => {});
      else await query('DELETE FROM players WHERE id = $1', [pl.id]).catch(() => {});
      pl.current_zone = zone0; pl.credits = cr0;
    }
  }
}
