// Encode an mp3 (or wav) recording to QOA for a zone's `flags.music` (client/shared/qoa.js).
//
//   node scripts/audio/qoa-encode.mjs <in.mp3> <out.qoa> [--rate 32000] [--mono]
//
// Prints the sizes and the round-trip error. Writes only <out.qoa>.
import fs from 'fs';
import { MPEGDecoder } from 'mpg123-decoder';
import '../../client/shared/qoa.js';

const [inPath, outPath] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--rate'));
if (!inPath || !outPath) { console.error('usage: qoa-encode.mjs <in.mp3> <out.qoa> [--rate N] [--mono]'); process.exit(1); }
const ri = process.argv.indexOf('--rate');
const rate = ri > 0 ? Number(process.argv[ri + 1]) : 0;
const mono = process.argv.includes('--mono');

const dec = new MPEGDecoder(); await dec.ready;
const src = fs.readFileSync(inPath);
let { channelData, sampleRate } = dec.decode(new Uint8Array(src));
dec.free();
if (mono && channelData.length > 1) {
  const m = new Float32Array(channelData[0].length);
  for (let i = 0; i < m.length; i++) m[i] = (channelData[0][i] + channelData[1][i]) / 2;
  channelData = [m];
}
if (rate && rate !== sampleRate) {   // linear resample; fine for a downward step on music
  const k = sampleRate / rate, n = Math.floor(channelData[0].length / k);
  channelData = channelData.map((d) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * k, j = x | 0, f = x - j; o[i] = d[j] * (1 - f) + (d[j + 1] ?? d[j]) * f; } return o; });
  sampleRate = rate;
}
const qoa = globalThis.QOA.encode(channelData, sampleRate);
fs.writeFileSync(outPath, qoa);
const back = globalThis.QOA.decode(qoa);
let se = 0, ss = 0;
for (let c = 0; c < channelData.length; c++) for (let i = 0; i < channelData[c].length; i++) { const e = channelData[c][i] - back.channelData[c][i]; se += e * e; ss += channelData[c][i] ** 2; }
const secs = channelData[0].length / sampleRate;
console.log(`${inPath}: ${(src.length / 1e6).toFixed(2)} MB mp3, ${secs.toFixed(1)} s, ${channelData.length} ch @ ${sampleRate} Hz`);
console.log(`${outPath}: ${(qoa.length / 1e6).toFixed(2)} MB QOA (${(qoa.length * 8 / secs / 1000).toFixed(0)} kbps), SNR ${(10 * Math.log10(ss / se)).toFixed(1)} dB`);
