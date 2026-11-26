// Settles the furniture of rooms whose pieces stand in each other: lays each room out as the roomstage plugin does
// (its en-suite apart), and for every pair that meets, moves the smaller piece to the nearest spot that's free and
// writes that spot to its row. The gate this answers is scripts/shapes/room-stage.mjs ("X stands in Y").
//
//   node scripts/content/room-settle.mjs <zone id> [<zone id> ...]           settle and write
//   node scripts/content/room-settle.mjs --dry <zone id> ...                 report only
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';
import { roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, placeSpot } from '../../client/shared/room-layout.js';

const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const Z = new Map(readDir('zones').map((z) => [z.id, z]));
const FU = new Map(readDir('furniture').map((f) => [f.id, f]));
const items = new Map(readDir('items').map((i) => [i.id, i])), itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
const annexOf = (z) => { const i = z?.exits?.in ? Z.get(Array.isArray(z.exits.in) ? z.exits.in[0] : z.exits.in) : null; const o = i?.exits?.out; return i && (Array.isArray(o) ? o[0] : o) === z.id && i.parent_zone === z.id ? i : null; };
const specById = (zid) => { const z = Z.get(zid); if (!z) return null; const m = parseInt(z.marker, 10); const s = roomSpecOf(z.flags, !!z.flags?.is_apartment, { storey: Number.isFinite(m) ? m : null }); if (!s) return null; const a = annexOf(z); return a ? withAnnex(s, a.id, a.name) : s; };
const r2 = (x) => +x.toFixed(2);
// pieces that may share floor: a rug under, an awning over, a pit's banquette round
// (and, as the gate has it, a set on the wall and a wall cabinet, which stand over what's under them)
const passes = (p) => p.form === 'rug' || p.form === 'awning' || p.form === 'banquette' || p.flat || p.on || p.spot?.on || (p.arche === 'screen' && !p.crt) || (p.arche === 'cabinet' && p.form !== 'vitrine' && p.form !== 'humidor');
// a piece's footprint by its turn, the gate's own measure
const fp = (p) => { const q = Math.round((((p.turn % 360) + 360) % 360) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [[p.u - hw, p.u + hw, p.v - hd, p.v + hd]]; };
const hits = (A, B) => A.some((a) => B.some((q) => a[0] < q[1] - 0.01 && a[1] > q[0] + 0.01 && a[2] < q[3] - 0.01 && a[3] > q[2] + 0.01));
const area = (p) => (p.w || 0) * (p.d || 0);
let wrote = 0, fails = 0;

for (const id of ids) {
  // the room as the gate lays it out: its own spec, not the building's view of it
  const spec = specById(id);
  if (!spec) { console.error(`✗ ${id}: no Stage spec`); fails++; continue; }
  // the room, then its en-suite in its own frame
  const parts = [{ zone: id, spec, opts: { finish: spec.finish } }];
  if (spec.annex) parts.push({ zone: spec.annex.zone, spec: annexFrame(spec).spec, opts: { annex: true, finish: spec.annex.finish } });
  for (const part of parts) {
    for (let round = 0; round < 12; round++) {
      const rows = [...FU.values()].filter((f) => f.zone_id === part.zone && f.object_type !== 'light');
      const L = roomLayout(part.spec, layRows(rows, part.spec, { ...part.opts }).pieces);   // (no item lookups: the gate lays rows out without them)
      const ps = L.placed.filter((p) => !passes(p));
      let pair = null;
      for (let i = 0; i < ps.length && !pair; i++) for (let j = i + 1; j < ps.length && !pair; j++) if (hits(fp(ps[i]), fp(ps[j]))) pair = [ps[i], ps[j]];
      if (!pair) break;
      // a coffee table rides with its sofa and takes no spot of its own, so the other piece moves
      const mover = pair[0].arche === 'table' ? pair[1] : pair[1].arche === 'table' ? pair[0] : area(pair[0]) <= area(pair[1]) ? pair[0] : pair[1];
      const others = L.placed.filter((p) => p.id !== mover.id).map((p) => ({ ...p, spot: p.spot?.on ? p.spot : { at: [p.u, p.v], turn: p.turn } }));
      const tries = [];
      const W = part.spec.w, D = part.spec.d;
      for (let v = 0.25; v <= D - 0.25 + 1e-6; v += 0.1) for (let u = -W / 2 + 0.25; u <= W / 2 - 0.25 + 1e-6; u += 0.1) for (const dt of [0, 90, -90, 180]) {
        tries.push({ spot: { at: [r2(u), r2(v)], turn: (((mover.turn ?? 0) + dt + 540) % 360) - 180 }, cost: Math.hypot(u - mover.u, v - mover.v) + (dt ? 0.4 : 0) });
      }
      tries.sort((a, c) => a.cost - c.cost);
      // free by placeSpot, which lets a seat tuck in at a table, and by the gate's footprints, which don't
      const solid = L.placed.filter((q) => q.id !== mover.id && !passes(q));
      const clear = (sp) => { const c = { u: sp.at[0], v: sp.at[1], turn: sp.turn, w: mover.w, d: mover.d }; return !solid.some((q) => hits(fp(c), fp(q))); };
      const hit = tries.find((t) => clear(t.spot) && placeSpot(part.spec, others, mover.arche, mover.dims, { crt: mover.crt, form: mover.form, test: t.spot }));
      if (!hit) { console.error(`✗ ${part.zone}: no free spot for ${mover.id}`); fails++; break; }
      const row = FU.get(mover.id), next = { ...row, flags: { ...(row.flags || {}), spot: hit.spot } };
      FU.set(row.id, next);
      console.log(`  ${part.zone.replace('zone_', '')}: ${mover.id} out of ${(mover === pair[0] ? pair[1] : pair[0]).id} -> ${JSON.stringify(hit.spot)}`);
      if (!DRY) { fs.writeFileSync(path.join(C, 'furniture', `${row.id}.json`), canonicalJson(next)); wrote++; }
    }
  }
}
console.log(`${fails ? '✗' : '✓'} room-settle: ${wrote} pieces ${DRY ? 'would move' : 'moved'}${fails ? `, ${fails} problem(s)` : ''}`);
process.exit(fails ? 1 : 0);
