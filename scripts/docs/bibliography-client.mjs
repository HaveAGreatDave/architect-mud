#!/usr/bin/env node
// Writes client/shared/bibliography.json from docs/reference/bibliography.md, for the
// tablet's Settings → Bibliography page. The doc is the one source; this only reshapes it.
//
//   node scripts/docs/bibliography-client.mjs           write the JSON
//   node scripts/docs/bibliography-client.mjs --check   fail if the JSON is out of date (the gate)
//
// What players see: every heading, paragraph and table, with links into the repo reduced to
// their text and the "Where" column (repo docs) left out. Links to the web stay links.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(root, 'docs', 'reference', 'bibliography.md');
const OUT = join(root, 'client', 'shared', 'bibliography.json');

// Inline markdown to a list of runs: { t } plain text, { t, href } a web link.
function inline(s) {
  const runs = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m;
  const plain = (x) => x.replace(/\*\*|`/g, '');
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ t: plain(s.slice(last, m.index)) });
    const text = plain(m[1]);
    runs.push(/^https?:\/\//.test(m[2]) ? { t: text, href: m[2] } : { t: text });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ t: plain(s.slice(last)) });
  // Merge neighbouring plain runs.
  const out = [];
  for (const r of runs) {
    const p = out[out.length - 1];
    if (p && !p.href && !r.href) p.t += r.t; else out.push(r);
  }
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function build(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let title = 'Bibliography';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    let h;
    if ((h = /^(#{1,3})\s+(.*)$/.exec(l))) {
      if (h[1] === '#') title = h[2]; else blocks.push({ h: h[1].length, text: h[2] });
      continue;
    }
    if (l.startsWith('|')) {
      const head = cells(l);
      i++; // the |---| row
      const keep = head.map((c, k) => (c.toLowerCase() === 'where' ? -1 : k)).filter(k => k >= 0);
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith('|')) {
        const r = cells(lines[++i]);
        rows.push(keep.map(k => inline(r[k] || '')));
      }
      blocks.push({ table: keep.map(k => head[k]), rows });
      continue;
    }
    blocks.push({ p: inline(l) });
  }
  return { title, blocks };
}

const json = JSON.stringify(build(readFileSync(SRC, 'utf8'))) + '\n';
if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(OUT, 'utf8'); } catch {}
  if (cur !== json) {
    console.error('bibliography: client/shared/bibliography.json is out of date with docs/reference/bibliography.md.\nRun: node scripts/docs/bibliography-client.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
}
