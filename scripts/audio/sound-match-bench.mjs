// SOUND MATCH BENCH: run sound-match.mjs over a folder of recordings and table the distances, so a
// change to the matcher is measured on many sounds at once rather than judged on one.
//
//   node scripts/audio/sound-match-bench.mjs <dir|file...> [--budget 1200] [--jobs 4] [--out dir]
//
// Each file is matched in its own process (one per core up to --jobs). Prints one row per file,
// best template and distance, then the median and how many came out close (< 0.7),
// recognisable (< 1.2) and missed (the scale is in sound-match.mjs's header). Writes each match
// into <out>/<file>/ as sound-match.mjs does.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const budget = arg('--budget', '1200'), jobs = +arg('--jobs', Math.max(1, cpus().length - 1));
const out = resolve(arg('--out', join(HERE, '..', '..', 'sound-match-out', 'bench')));
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const files = inputs.flatMap((p) => statSync(p).isDirectory()
  ? readdirSync(p).filter((f) => /\.wav$/i.test(f)).sort().map((f) => join(p, f)) : [p]);
if (!files.length) { console.log('usage: sound-match-bench.mjs <dir|file...> [--budget N] [--jobs N] [--out dir]'); process.exit(1); }

const run = (file) => new Promise((done) => {
  const name = `${basename(dirname(file))}_${basename(file).replace(/\.[^.]+$/, '')}`.replace(/[^\w-]+/g, '_');
  const p = spawn(process.execPath, [join(HERE, 'sound-match.mjs'), file, '--name', name, '--budget', budget, '--out', join(out, name)]);
  let text = '';
  p.stdout.on('data', (d) => { text += d; });
  p.stderr.on('data', (d) => { text += d; });
  p.on('close', () => {
    const m = text.match(/best: (.+?)\s+distance ([\d.]+)/);
    done({ name, label: m ? m[1] : `failed: ${text.trim().split('\n').pop()}`, d: m ? +m[2] : Infinity });
  });
});

const rows = [], queue = [...files];
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => {
  while (queue.length) { const r = await run(queue.shift()); rows.push(r); console.log(`${r.d.toFixed(3).padStart(7)}  ${r.name.padEnd(28)} ${r.label}`); }
}));
const ds = rows.map((r) => r.d).sort((a, b) => a - b);
const close = ds.filter((d) => d < 0.7).length, near = ds.filter((d) => d >= 0.7 && d < 1.2).length;
console.log(`\n${rows.length} sounds: median ${ds[Math.floor(ds.length / 2)].toFixed(3)}, ${close} close, ${near} recognisable, ${rows.length - close - near} missed`);
