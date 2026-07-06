// One-shot content seed: corp recruitment posters in the starting area.
//
//   node scripts/seed-corp-posters.mjs
//
// Eye-catching, mock-heroic Franchise loyalty-program propaganda pasted where a
// brand-new player can't miss it (clone facility, Franchise Strip, the Threshold).
// The art + slogan live here in the furniture `description`; the corps plugin's
// `furniture.describe` hook unfurls the actionable pitch (how to found a corp, the
// command list, a clickable link) beneath it on examine.
//
// `flags.corp_poster` (NOT `hero_poster`) marks them as fixed wall propaganda, so
// the posters plugin's peel/takedown mechanic does not apply. A few carry
// `flags.architect_wink` — fine print that only pays off once you learn what corps
// really serve. Idempotent upsert. Content-only — /world reload or restart after.
import { query } from '../server/models/db.js';

const POSTERS = [
  {
    id: 'furn_corp_poster_start_a', zone: 'zone_start',
    name: 'a glossy recruitment poster',
    desc: "A brand-new poster, edges still square, pasted at eye level right where a freshly-decanted clone can't miss it. A grinning figure in a crisp collar holds a whole city district in one open palm, skyline and all, the way a promo still holds a burger. Above, in that warm, focus-grouped Franchise green: YOU'VE BEEN REPRINTED. NOW MAKE IT COUNT. Below, smaller: \"Nobody's coming to save you. Good news — the successful never needed saving. Start a Corp. Own a piece. Belong to something that wins.\" A little sunburst logo promises MEMBER BENEFITS.",
  },
  {
    id: 'furn_corp_poster_start_b', zone: 'zone_start',
    name: 'a blown-up business card taped beside the vats',
    desc: "Not a poster so much as a business card enlarged and taped crooked beside the decanting vats, where the newly-reprinted drip and blink at the light. A hand reaches out of the frame, offering a key. STEP ONE OF THE REST OF YOU: OWN SOMETHING. In tidy type beneath: \"You woke up with nothing and no one. That isn't a tragedy — it's an opening. Corps are hiring. Corps are founding. Be on the right side of the org chart.\"",
  },
  {
    id: 'furn_corp_poster_strip_a', zone: 'zone_city_west',
    name: 'a towering Franchise recruitment banner',
    desc: "A banner three storeys tall unrolled down the face of a gutted storefront, so bright it seems to hum. A crowd of identical smiling owners raise identical branded mugs toward a sunrise that is mostly logo. BE SOMEBODY. FRANCHISE THE FUTURE. Underneath, in loyalty-program cursive: \"From nobody to name-brand. Your Corp, your colours, your corner of a city that respects exactly one thing — results.\"",
    wink: true,
  },
  {
    id: 'furn_corp_poster_strip_b', zone: 'zone_city_west',
    name: 'a hand-stapled corp recruitment flyer',
    desc: "A cheaper flyer stapled over the big banner's ankle by someone with a rougher agenda — same green, ragged edges, printed in a back room by the look of it. A gloved fist closes around a single city block. NORTH OF HERE, THE RENT IS BLOOD AND THE RETURN IS EVERYTHING. Below, hand-lettered: \"The good ground's already spoken for. Found a crew, take a corner, and maybe — maybe — earn a look at the north, where the real money sleeps.\"",
    wink: true,
  },
  {
    id: 'furn_corp_poster_threshold_a', zone: 'zone_threshold',
    name: 'a recruitment poster plastered over the departure boards',
    desc: "Someone has pasted this square over half a cracked departure board, and nobody's dared peel it. A lone figure stands at the apex of a wireframe pyramid built of smaller figures, arms flung wide, triumphant. THE STRONG ORGANISE. THE REST WAIT FOR A TRAIN THAT ISN'T COMING. In smaller type: \"Alone, you're a statistic. In a Corp, you're a shareholder. Claim ground. Hold it. Make the map say your name.\"",
  },
  {
    id: 'furn_corp_poster_threshold_b', zone: 'zone_threshold',
    name: 'a peeling Franchise loyalty poster',
    desc: "An older one, corners lifting, the green gone the colour of a nicotine ceiling — but the smile underneath hasn't aged a day. A mascot shaped like a friendly briefcase gives two thumbs up beside a bar chart that only goes up. JOIN. CLIMB. REPEAT. IT'S THAT SIMPLE. Beneath: \"Ranks. Treasury. Territory. Everything a person needs, and nothing a person is. Ask about franchise ownership today.\"",
    wink: true,
  },
];

async function seed() {
  const zones = [...new Set(POSTERS.map(p => p.zone))];
  const { rows } = await query('SELECT id FROM zones WHERE id = ANY($1)', [zones]);
  const present = new Set(rows.map(r => r.id));

  let n = 0;
  for (const p of POSTERS) {
    if (!present.has(p.zone)) { console.warn(`⚠ skip ${p.id}: zone ${p.zone} not found`); continue; }
    const flags = { corp_poster: true };
    if (p.wink) flags.architect_wink = true;
    await query(
      `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
       VALUES ($1,$2,$3,$4,'decoration',$5)
       ON CONFLICT (id) DO UPDATE SET
         zone_id=EXCLUDED.zone_id, name=EXCLUDED.name, description=EXCLUDED.description,
         object_type='decoration', flags=EXCLUDED.flags`,
      [p.id, p.zone, p.name, p.desc, JSON.stringify(flags)]
    );
    n++;
    console.log(`✓ ${p.name} → ${p.zone}${p.wink ? ' (architect wink)' : ''}`);
  }
  console.log(`\n✓ Seeded ${n}/${POSTERS.length} corp poster(s). Restart the server (or /world reload) to hang them.`);
}

seed().then(() => process.exit(0)).catch(e => { console.error('✗ seed failed:', e); process.exit(1); });
