// Compile data/scripts/hockey.bsm into the three content rows that put Cluster Puck
// on the air, writing them straight into the content/ tree.
//
// WHY THIS EXISTS. The normal authoring path is the dev panel's .bsm import, which
// compiles the script and writes the rows to the local DB — then content:export dumps
// them to content/. That's a fine loop for a human at a browser, but it means the .bsm
// and the shipped row can drift silently: the file in git is the source of the show,
// and nothing checks the row still matches it. This regenerates the rows FROM the file,
// so re-running it after editing hockey.bsm is how the two stay in step.
//
// Additive only — it writes three NEW files. The one change to an existing row (handing
// Deadball back two nights) is deliberately NOT done here; see the note at the bottom.
//
//   node scripts/content/build-cluster-puck.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The compiler is a browser script that drops `compileBsm` into global scope; the repo
// is "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const compiled = compileBsm(rd('data/scripts/hockey.bsm'));
const { meta, broadcastGraph, sportsScript, assets } = compiled;

if (meta.type !== 'sports' || meta.sport !== 'hockey') {
  console.error(`✗ hockey.bsm is not a hockey sports script (@type ${meta.type}, @sport ${meta.sport})`);
  process.exit(1);
}
if (compiled._debug.unknownDirectives.length) {
  console.error(`✗ unknown directives in hockey.bsm: ${compiled._debug.unknownDirectives.join(', ')}`);
  process.exit(1);
}

// Stable ids. Hand-written rather than timestamped so re-running this is idempotent and
// the playlist entry can reference the broadcast without a lookup.
const BROADCAST_ID = 'bc_cluster_puck';
const CHANNEL_ID = 'ch_7_1782953079593';        // KSAB-TV, the only channel
const GRAPHIC_ID = 'cphl_title';
// No playlist row is written here. Every game airs on KSAB5 through its sports slate row
// (content/media_channel_playlist/ksab5-slate.json), and KSAB-TV relays the 18:00 one
// (docs/proposals/daily-slate.md).
const STAMP = '1785000000';                     // fixed: these rows are content, not events

const write = (rel, obj) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  console.log(`  wrote ${rel}`);
};

// The clubs' identities (colours, kits, crests) are authored by build-cphl-clubs.mjs into
// this same row's sports_pools.clubs, and the barn every game is played in (Golden Goose
// Gardens: its site, its name and the city's art direction round it) is sports_pools.venue,
// neither from the .bsm, so a rebuild carries both over.
{
  const prev = path.join(ROOT, `content/media_broadcasts/${BROADCAST_ID}.json`);
  if (fs.existsSync(prev)) {
    const kept = JSON.parse(fs.readFileSync(prev, 'utf8')).sports_pools || {};
    if (kept.clubs) sportsScript.clubs = kept.clubs;
    if (kept.venue) sportsScript.venue = kept.venue;
  }
}

write(`content/media_broadcasts/${BROADCAST_ID}.json`, {
  broadcast_graph: broadcastGraph,
  category: meta.category || 'sport',
  channel_id: CHANNEL_ID,
  created_by: null,
  description: 'CPhL hockey from Coldwater, called by Tug Brennan. A fresh sixty minutes is simulated every airing.',
  enabled: 1,
  fallback_messages: [],
  id: BROADCAST_ID,
  loop: 1,
  message_interval: 5,
  messages: [],
  morning_pools: null,
  name: meta.name,
  news_pools: null,
  override_duration: meta.length || 300,
  playback_mode: 'sports',
  sports_pools: sportsScript,
  tags: [],
  talkshow_pools: null,
  updated_at: STAMP,
  weather_pools: null,
});

const titleAsset = assets.find((a) => a.id === GRAPHIC_ID);
if (!titleAsset) { console.error(`✗ hockey.bsm has no ::asset ${GRAPHIC_ID}`); process.exit(1); }
write(`content/media_graphics/${GRAPHIC_ID}.json`, {
  content: titleAsset.content,
  created_at: STAMP,
  description: 'Cluster Puck broadcast open — animated CPhL title card.',
  id: GRAPHIC_ID,
  name: GRAPHIC_ID,
  tags: [],
  type: titleAsset.type || 'ascii',
  updated_at: STAMP,
});

console.log(`\n✓ Cluster Puck built from hockey.bsm`);
console.log(`  ${sportsScript.teams.length} clubs · ${sportsScript.players.length} skaters · ${Object.keys(sportsScript.pools).length} line pools · airSlots ${JSON.stringify(sportsScript.airSlots)}`);
console.log('  Airs on KSAB5 by the daily slate; KSAB-TV relays the 18:00 game.');
