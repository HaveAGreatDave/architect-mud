// SOUND MATCH SMOKE: the matcher still finds a known FM patch, and the composed loops are what
// their script writes and what the critic passes.
//
//   node scripts/audio/sound-match-smoke.mjs
//
// WHAT IT GUARDS:
//   • the analysis reads a bell's carrier and ratio off its partials: a 330 Hz carrier at ratio
//     3.5, whose strongest line is 1980 Hz and whose f0 is 165 Hz (the miss that started this)
//   • a short search through the real engine gets that bell within 0.5 of its target
//   • two takes of one noise patch stay under 0.6 apart (the distance is smoothed; unsmoothed
//     they were 1.03)
//   • build-ambient-loops.mjs --check: the seven loops' files are what the script writes
//   • song-lint has no warning for any of them
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tally, ROOT } from './stub-context.mjs';
import { render, fmPairs, match } from './sound-match.mjs';
import { analyse, Distance, trim } from './match-lib.mjs';

const { check, done } = tally('audio:sound-match');
const SR = 22050;

const bell = { duration: 0.05, layers: [{ waveform: 'sine', freq: 330, gain: 0.6, fm: { ratio: 3.5, index: 4, indexEnd: 0.4, time: 0.8 }, adsr: { a: 0.002, d: 1.2, s: 0, r: 0.4, curve: 'exp' } }] };
const x = trim(await render(bell, 1.2), SR);
const pairs = fmPairs(analyse(x, SR));
check('the bell\'s carrier and ratio come first', pairs[0] && Math.abs(pairs[0].c / 330 - 1) < 0.01 && Math.abs(pairs[0].ratio - 3.5) < 0.02, JSON.stringify(pairs.slice(0, 3)));
const r = await match(x, { only: ['fm'], budget: 500 });
check('a short search gets the bell within 0.5', r.distance.total < 0.5, `${r.label} ${r.distance.total.toFixed(3)}`);

const noise = (seed) => ({ duration: 0.05, layers: [{ waveform: 'noise', noiseMix: 1, noiseSeed: seed, gain: 0.5, filter: { type: 'bandpass', freq: 1000, q: 1 }, adsr: { a: 0.001, d: 0.2, s: 0, r: 0.1, curve: 'exp' } }] });
const nd = new Distance(await render(noise(3), 0.4), SR).of(await render(noise(99), 0.4)).total;
check('two takes of one noise patch are under 0.6 apart', nd < 0.6, nd.toFixed(3));

try { execFileSync(process.execPath, [join(ROOT, 'scripts/content/build-ambient-loops.mjs'), '--check'], { stdio: 'pipe' }); check('the loops are what build-ambient-loops.mjs writes', true); }
catch (e) { check('the loops are what build-ambient-loops.mjs writes', false, String(e.stderr || e.message).trim().split('\n')[0]); }
const { songs, instruments } = await import('../content/build-ambient-loops.mjs');
const { lint } = await import('./song-lint.mjs');
const byId = Object.fromEntries(instruments.map((i) => [i.id, i]));
for (const s of songs) {
  const warns = lint(s, byId).findings.filter((f) => f.level === 'warn');
  check(`${s.name} passes the critic`, !warns.length, warns.map((w) => w.msg).join('; '));
}
done();
