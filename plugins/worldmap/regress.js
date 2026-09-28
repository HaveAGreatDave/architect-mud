// worldmap regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async ({ run, check }) => {
  const p = _test.worldPayload();
  check('worldmap: every region ships its rows', p.regions.length >= 5 && p.regions.every((r) => r.rows.length === r.maxY - r.minY + 1),
    `regions=${p.regions.length}`);
  const keys = new Set(Object.keys(p.key));
  const bad = p.regions.flatMap((r) => r.rows.join('').split('')).filter((c) => c !== ' ' && !keys.has(c));
  check('worldmap: every row character is in the key', bad.length === 0, `unknown: ${[...new Set(bad)].join('')}`);
  check('worldmap: the roads arrive, each with a route number', p.roads.length > 0 && p.roads.every((r) => r.num && r.pts.length >= 4),
    JSON.stringify(p.roads.map((r) => [r.a, r.b, r.num])));
  // A number may be shared only by legs that chain through a region (Route 1 runs Coldwater ->
  // the Scarletwastes -> Terminus), never by two roads that have nothing to do with each other.
  const byNum = new Map(); for (const r of p.roads) (byNum.get(r.num) || byNum.set(r.num, []).get(r.num)).push(r);
  const shared = [...byNum].filter(([, rs]) => rs.length > 1 && !rs.every((r, i) => i === 0 || [r.a, r.b].some((x) => [rs[i - 1].a, rs[i - 1].b].includes(x))));
  check('worldmap: a shared route number only joins roads that meet', !shared.length, shared.map(([n]) => n).join(','));
  const t = _test.textMap({ current_zone: null });
  check('worldmap: the text map draws sea, road and a region', t.art.some((l) => l.includes('~')) && t.art.some((l) => l.includes('='))
    && t.art.some((l) => /[A-Z]/.test(l)), t.art.slice(0, 3).join('|'));
  const out = await run('worldmap');
  check('worldmap: the verb routes', /WORLD MAP/.test(JSON.stringify(out)), JSON.stringify(out).slice(0, 160));
};
