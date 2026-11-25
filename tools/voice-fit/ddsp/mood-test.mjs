// mood-test.mjs: the fitted voice in each mood (docs/proposals/delivery.md, phase 1), and a
// blind test of whether a listener can tell which.
//
//   node tools/voice-fit/ddsp/mood-test.mjs build <dir>          render, measure, write the test
//   node tools/voice-fit/ddsp/mood-test.mjs serve <dir> [--port 5654]
//   node tools/voice-fit/ddsp/mood-test.mjs score <dir>
//
// build renders LINES in every mood with a voice row (and plain) through the real worklet,
// prints each mood's level, median F0 and length against plain, writes jobs.json for
// effort-wer.py (the Whisper check, by mood), and makes the test: every line in every mood
// as a numbered WAV in a shuffled order, items.json (what the page sees: numbers only) and
// key.json (which mood each was, read only by score). The page plays one at a time and asks
// which mood it heard; score prints the hit rate and the confusions.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, DIR] = process.argv.slice(2);
if (!cmd || !DIR) { console.error('usage: mood-test.mjs build|serve|score <dir>'); process.exit(2); }
const SR = 48000;
// mood-neutral words, so the text doesn't give the answer away
const LINES = [
  'I left it on the table by the door.', 'The last bus goes at ten.', 'He said he would be back on Tuesday.',
  'They moved the market to the other side of the bridge.', 'You can have the room upstairs.', 'Is that the one from yesterday?',
];

if (cmd === 'build') {
  const { setup } = await import('../synth.mjs');
  const { voiceDelivery, VOICE_MOODS } = await import('../../../client/shared/delivery.js');
  const MOODS = ['plain', ...Object.keys(VOICE_MOODS)];
  mkdirSync(join(DIR, 'wav'), { recursive: true });
  const voice = JSON.parse(readFileSync('data/voice/fitted-voice.json', 'utf8')).voice;
  const { render } = await setup();
  const rms = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-12); };
  const f0 = () => {
    const L = render.last, n = L.names.length, fi = L.names.indexOf('f0'), ai = L.names.indexOf('av'), f = [];
    for (let t = 0; t < L.frames; t++) if (L.tracks[t * n + ai] > 0.3) f.push(L.tracks[t * n + fi]);
    f.sort((a, b) => a - b); return f.length ? f[f.length >> 1] : 0;
  };
  const jobs = [], items = [], st = {};
  for (const [li, text] of LINES.entries()) {
    for (const m of MOODS) {
      const b = m === 'plain' ? null : voiceDelivery({ mood: m, i: 1 });
      const y = render(text, voice, null, b ? { delivery: b } : null).map((v) => v * (b ? b.gain : 1));
      const raw = join(DIR, `${li}-${m}.raw`);
      writeFileSync(raw, Buffer.from(y.buffer));
      jobs.push({ id: String(li), effort: m, text, raw });
      (st[m] ||= []).push({ db: rms(y), f0: f0(), s: y.length / SR });
      items.push({ y, m, li });
    }
  }
  const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
  for (const m of MOODS) console.log(`${m.padEnd(9)} level ${(mean(st[m], 'db') - mean(st.plain, 'db')).toFixed(1).padStart(5)} dB, F0 ${(12 * Math.log2(mean(st[m], 'f0') / mean(st.plain, 'f0'))).toFixed(1).padStart(5)} st, length ${(mean(st[m], 's') / mean(st.plain, 's')).toFixed(2)}`);
  writeFileSync(join(DIR, 'jobs.json'), JSON.stringify(jobs, null, 1));
  // shuffle with a fixed seed, so a rebuild gives the same test
  let h = 7; const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2654435761) >>> 0) / 4294967296);
  for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [items[k], items[j]] = [items[j], items[k]]; }
  const key = {};
  items.forEach((it, n) => {
    key[n] = { mood: it.m, line: it.li };
    // each clip at one loudness, so level alone doesn't say which mood (the game's own levels are kept in the .raw files)
    let pk = 0; for (const v of it.y) pk = Math.max(pk, Math.abs(v));
    const pcm = Buffer.alloc(44 + it.y.length * 2);
    pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + it.y.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
    pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(it.y.length * 2, 40);
    for (let k = 0; k < it.y.length; k++) pcm.writeInt16LE(Math.round(it.y[k] / pk * 0.8 * 32767), 44 + 2 * k);
    writeFileSync(join(DIR, 'wav', `${n}.wav`), pcm);
  });
  writeFileSync(join(DIR, 'key.json'), JSON.stringify(key));
  writeFileSync(join(DIR, 'items.json'), JSON.stringify({ n: items.length, moods: MOODS }));
  console.log(`${items.length} clips; serve with: node tools/voice-fit/ddsp/mood-test.mjs serve ${DIR}`);
}

const ANS = join(DIR, 'answers.json');
const answers = () => (existsSync(ANS) ? JSON.parse(readFileSync(ANS, 'utf8')) : {});

if (cmd === 'score') {
  const key = JSON.parse(readFileSync(join(DIR, 'key.json'), 'utf8')), ans = answers();
  const { moods } = JSON.parse(readFileSync(join(DIR, 'items.json'), 'utf8'));
  const conf = {}; let hit = 0, n = 0;
  for (const [k, a] of Object.entries(ans)) {
    const m = key[k].mood; (conf[m] ||= {})[a] = (conf[m][a] || 0) + 1; n++; if (a === m) hit++;
  }
  console.log(`${n} of ${Object.keys(key).length} answered; right ${hit} (${n ? (100 * hit / n).toFixed(0) : 0}%), chance ${(100 / moods.length).toFixed(0)}%`);
  for (const m of moods) if (conf[m]) console.log(`  ${m.padEnd(9)} heard as ${Object.entries(conf[m]).sort((a, b) => b[1] - a[1]).map(([x, c]) => `${x} ${c}`).join(', ')}`);
}

if (cmd === 'serve') {
  const pi = process.argv.indexOf('--port'), port = pi > 0 ? +process.argv[pi + 1] : 5654;
  const { n, moods } = JSON.parse(readFileSync(join(DIR, 'items.json'), 'utf8'));
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Which mood?</title>
<style>:root{--bg:#f6f5f2;--fg:#1d1d1b;--card:#fff;--line:#d6d3cc;--accent:#2a6f97;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1e;--fg:#e8e6e1;--card:#26282b;--line:#3a3d41;--accent:#6fb3d9;--on:#111}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:640px;margin:auto}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:10px 14px;cursor:pointer}
button:hover{border-color:var(--accent)} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:16px 0}
#play{width:100%;font-size:1.1rem;background:var(--accent);color:var(--on);border-color:var(--accent)} .dim{opacity:.7}</style></head><body>
<h1>Which mood?</h1><p class="dim">Play the clip, then pick the mood you hear. The words are the same in every mood; only the voice changes. Every clip is at the same loudness.</p>
<p id="count" class="dim"></p><button id="play">Play</button><div class="grid" id="g"></div>
<script>const N=${n},M=${JSON.stringify(moods)};let ans={},i=0;
const nextOpen=()=>{for(let k=0;k<N;k++)if(!ans[k])return k;return -1};
function show(){const d=Object.keys(ans).length;document.getElementById('count').textContent=d+' of '+N+' answered';if(i<0){document.getElementById('play').disabled=true;document.getElementById('play').textContent='All done, thank you';}}
document.getElementById('play').onclick=()=>{if(i>=0)new Audio('/wav/'+i+'.wav').play()};
document.getElementById('g').innerHTML=M.map(m=>'<button data-m="'+m+'">'+m+'</button>').join('');
document.getElementById('g').onclick=async e=>{const m=e.target.dataset?.m;if(!m||i<0)return;ans[i]=m;await fetch('/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({n:i,m})});i=nextOpen();show();if(i>=0)new Audio('/wav/'+i+'.wav').play()};
fetch('/answers').then(r=>r.json()).then(a=>{ans=a;i=nextOpen();show()});</script></body></html>`;
  createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page); }
    if (req.url === '/answers') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(answers())); }
    if (req.url === '/answer' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const { n: k, m } = JSON.parse(b); const a = answers(); a[k] = m; writeFileSync(ANS, JSON.stringify(a, null, 1)); res.end('ok'); });
      return;
    }
    const m = /^\/wav\/(\d+)\.wav$/.exec(req.url);
    if (m) { const f = normalize(join(DIR, 'wav', `${m[1]}.wav`)); if (existsSync(f)) { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(readFileSync(f)); } }
    res.writeHead(404); res.end();
  }).listen(port, () => console.log(`mood test on http://localhost:${port}`));
}
