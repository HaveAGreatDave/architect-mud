// Compile the three Mint Condition rental features out of data/scripts/*.bsm into
// content/media_broadcasts + content/media_graphics rows, and strike the beta cassette
// item that each one is rented on.
//
// Same reasoning as build-cluster-puck.mjs: the dev panel's .bsm import is a fine loop
// for a human at a browser, but it lets the script in git and the shipped row drift
// silently. This regenerates the rows FROM the files, so re-running it after editing a
// .bsm is how the two stay in step.
//
//   node scripts/content/build-mintcond-films.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The compiler is a browser script that drops `compileBsm` into global scope; the repo
// is "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();

const CHANNEL_ID = 'ch_7_1782953079593';   // KSAB-TV, the only channel
const STAMP = '1785500000';                // fixed: these rows are content, not events

const FILMS = [
  {
    script: 'captain_quorum.bsm',
    id: 'bc_captain_quorum',
    graphic: 'captain_quorum_title',
    item: 'item_betatape_captain_quorum',
    itemName: 'betatape: CAPTAIN QUORUM',
    value: 60,
    description: 'A pre-Collapse civic morale feature about a man whose superpower is procedure. The stock is better than anything printed since and the politics have not aged so much as fossilised.',
    label: [
      '  ┌───────────────────────────────┐',
      '  │ ░░░░░  CAPTAIN QUORUM  II     │',
      '  │ ░   ░  ───────────────────────│',
      '  │ ░░░░░  DIRECTORATE · 13 MIN   │',
      '  │  ( )    ( )   REEL 2 SPLICED  │',
      '  │ ═══════════════════════════   │',
      '  └───────────────────────────────┘',
    ],
    shell: 'A cassette in a shell of municipal green, which is not a colour anybody has manufactured since. The case is the original: hinged, printed, with a little slot inside for a card that is still in there. The spine label is not handwritten. Nothing about this tape is handwritten.',
    note: 'The card in the case reads, in printed capitals: RETURN TO YOUR CIVIC LIBRARY WITHIN SEVEN DAYS. There is no civic library.',
  },
  {
    script: 'night_shift_number_four.bsm',
    id: 'bc_night_shift_number_four',
    graphic: 'night_shift_title',
    item: 'item_betatape_night_shift',
    itemName: 'betatape: NIGHT SHIFT AT NUMBER FOUR',
    value: 45,
    description: 'An unofficial foundry ghost picture shot in eleven nights, in a working foundry, without asking. Two frames in the second act are missing from almost every copy.',
    label: [
      '  ┌───────────────────────────────┐',
      '  │ ▒▒▒▒▒  NIGHT SHIFT  /  No.4   │',
      '  │ ▒   ▒  ───────────────────────│',
      '  │ ▒▒▒▒▒  DRIVE-IN PRINT · 14MIN │',
      '  │  ( )    ( )   TWO FRAMES GONE │',
      '  │ ═══════════════════════════   │',
      '  └───────────────────────────────┘',
    ],
    shell: 'A fat little cassette in a shell that has been warm too often, so the plastic has gone slightly soft at the corners. The window is scratched in an arc where somebody wound it back to the same place over and over with a pencil.',
    note: 'Underneath, in marker, in a hand that pressed hard: "THE FRAMES ARE NOT ON THIS ONE EITHER. STOP ASKING."',
  },
  {
    script: 'form_nine.bsm',
    id: 'bc_form_nine',
    graphic: 'form_nine_title',
    item: 'item_betatape_form_nine',
    itemName: 'betatape: FORM 9',
    value: 15,
    description: 'Fourteen weeks of a wall, edited down to eleven minutes, shot on a consumer deck by somebody who did not know the word for any of it. No distributor and no rights.',
    label: [
      '  ┌───────────────────────────────┐',
      '  │        F O R M   9            │',
      '  │ ──────────────────────────────│',
      '  │  COPY THIS TAPE · 11 MIN      │',
      '  │  ( )    ( )   GEN 4 OR WORSE  │',
      '  │ ═══════════════════════════   │',
      '  └───────────────────────────────┘',
    ],
    shell: 'A cassette with no case and no printed anything, the shell a scavenged one with the old label scraped off in a hurry, so a shred of somebody else\'s title is still stuck under the corner. It has been copied from a copy from a copy and it looks it.',
    note: 'Written across the top in ballpoint, biting into the plastic: "RUN OFF AS MANY AS YOU LIKE. DO NOT PAY FOR IT AND DO NOT CHARGE FOR IT."',
  },
];

const write = (rel, obj) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  console.log(`  wrote ${rel}`);
};

for (const f of FILMS) {
  const compiled = compileBsm(rd(`data/scripts/${f.script}`));
  const { meta, broadcastGraph, filmScript, assets } = compiled;

  if (meta.type !== 'film') {
    console.error(`✗ ${f.script} is not a film (@type ${meta.type})`);
    process.exit(1);
  }
  if (compiled._debug.unknownDirectives.length) {
    console.error(`✗ unknown directives in ${f.script}: ${compiled._debug.unknownDirectives.join(', ')}`);
    process.exit(1);
  }

  write(`content/media_broadcasts/${f.id}.json`, {
    broadcast_graph: broadcastGraph,
    category: meta.category || 'film',
    channel_id: CHANNEL_ID,
    created_by: null,
    description: f.description,
    enabled: 1,
    fallback_messages: [],
    film_meta: filmScript || null,
    gameshow_pools: null,
    id: f.id,
    loop: 1,
    message_interval: 5,
    // A film's flat `messages` list is its whole screenplay over again and nothing
    // reads it — the runner plays the graph. Same rule the dev-panel import follows.
    messages: [],
    morning_pools: null,
    name: meta.name,
    news_pools: null,
    override_duration: meta.length || null,
    playback_mode: 'film',
    sermon_pools: null,
    sports_pools: null,
    tags: [],
    talkshow_pools: null,
    updated_at: STAMP,
    weather_pools: null,
  });

  const titleAsset = assets.find((a) => a.id === f.graphic);
  if (!titleAsset) { console.error(`✗ ${f.script} has no ::asset ${f.graphic}`); process.exit(1); }
  write(`content/media_graphics/${f.graphic}.json`, {
    content: titleAsset.content,
    created_at: STAMP,
    description: `${meta.name} — title card.`,
    id: f.graphic,
    name: f.graphic,
    tags: [],
  });

  // The rentable object. A tape is an ordinary media item carrying `broadcast_id`, so
  // it loads into any deck exactly like the two that already existed; the rental half
  // lives entirely in plugins/videostore and never touches the item row.
  const desc = `${f.shell}\n\n${f.label.join('\n')}\n\n${f.note}`;
  write(`content/items/${f.item}.json`, {
    description: null,
    flags: {},
    id: f.item,
    name: f.itemName,
    tags: {
      beta_cassette: true,
      broadcast_id: f.id,
      description: desc,
      media_cassette: true,
    },
    type: 'media',
    value: f.value,
    weight: 220,
  });
}

console.log(`✓ built ${FILMS.length} films (broadcast + title card + cassette each)`);
