import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';
const W = await loadWindshield();
const snap = JSON.parse(readFileSync('client/game/flightsim-world.json', 'utf8'));
const hi = [];
for (const k in snap.cells) { const c = snap.cells[k];
  if (c.biome === 'cliff' || c.biome === 'plateau') { const [x,y]=k.split(',').map(Number); hi.push([x,y]); } }
const vn = W.__vnoise2 || null;
console.log('vnoise exported?', !!vn);
