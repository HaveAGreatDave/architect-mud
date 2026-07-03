/**
 * add-amp-cassettes.js — one-shot content seed for the AMP cassette economy.
 *
 * Creates one tradeable cassette item per server MOD (tag `amp_cassette`,
 * `tags.song_id` → the audio_songs row), and wires Nyra Voss to trade a cigarette
 * for the PSYCHOTECH tape (generic `flags.gift_trade` contract read by the amp
 * plugin). Idempotent — safe to re-run.
 *
 *   Run once:  DB_POOL_MAX=1 node scripts/add-amp-cassettes.js
 *
 * After running, restart the server (or reload the world) so Nyra's new flags
 * load into memory. The cassette items work immediately (read from DB per query).
 */
import { query } from '../server/models/db.js';

// song row name → cassette title + physical-tape description.
const TAPES = [
  { song: '1st_fracture', title: 'First Fracture',
    desc: 'A cracked-case cassette, FIRST FRACTURE hand-lettered in silver marker. Breakbeat built over the sound of something load-bearing finally giving way. Side B is the same track, slower and sadder.' },
  { song: 'aftermath', title: 'Aftermath',
    desc: 'A cassette that runs hot — 250 BPM of scorched-earth gabber. The label just says AFTERMATH over a smear of red marker you choose to read as marker. Not for weak speakers or weak hearts.' },
  { song: 'anarchy_0', title: 'Anarchy Zero',
    desc: 'A cassette mummified in black electrical tape, ANARCHY ZERO scratched into the shell with a knife. Acid-line agitprop from before the towers went dark. Still illegal in three sectors, allegedly.' },
  { song: 'drifting_mix', title: 'Drifting',
    desc: 'A translucent-shell cassette, the ribbon inside faintly blue. DRIFTING, the label reads, in a soft rounded hand. Long, weightless, quietly heartbroken — the sound of falling asleep on a moving train.' },
  { song: 'ooze_10second_trans', title: 'Ooze',
    desc: 'A squat little cassette that feels faintly tacky to the touch. OOZE / TEN-SECOND TRANSMISSION. Short, wet and hypnotic — over before you\'re sure it began, and lodged in your skull for a week.' },
  { song: 'psychotech', title: 'Psychotech',
    desc: 'A battered cassette worn pale at the corners, PSYCHOTECH in faded dot-matrix. Relentless, surgical and euphoric at once — the kind of track people say they "felt in their teeth". Somebody loved this tape very much before you got it.' },
];

const NYRA_ACCEPT = `Nyra takes the cigarette without a word. She sparks it, draws deep, and for the length of one exhale the controlled stillness cracks — shoulders dropping, iris ring dimming to something almost soft. "You want to <em>feel</em> something in this city," she says, smoke leaking out around the words, "you play this." A battered cassette turns up between her fingers and she presses it into your palm. "<span class="msg-system">PSYCHOTECH</span>. I wore three decks out on it. Gets in behind the ribs and rewires you — I felt it in my teeth the first time I heard it." The ring flickers, almost embarrassed at how much she meant that.`;

const NYRA_ALREADY = `Nyra exhales a thin line of smoke and shakes her head, the old calm back in place. "Already hooked you up, sweetheart. One good song's enough to ruin a person. Go find your own frequencies now."`;

async function main() {
  for (const t of TAPES) {
    const { rows } = await query(`SELECT id FROM audio_songs WHERE name = $1 AND category = 'misc'`, [t.song]);
    if (!rows.length) { console.warn(`⚠ no misc song named "${t.song}" — skipping`); continue; }
    const songId = rows[0].id;
    const itemId = `item_amptape_${t.song}`;
    const itemName = `${t.title} — cassette tape`;
    const tags = JSON.stringify({ amp_cassette: true, song_id: songId });
    await query(
      `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, is_unique, tags)
       VALUES ($1, $2, $3, 'media', 'cassette', 100, 450, 0, 0, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, value = 450, tags = $4::jsonb`,
      [itemId, itemName, t.desc, tags]
    );
    console.log(`✓ ${itemName}  →  ${songId}`);
  }

  const giftTrade = {
    give_item: 'item_cigarettes',
    reward_item: 'item_amptape_psychotech',
    once: true,
    accept_message: NYRA_ACCEPT,
    already_message: NYRA_ALREADY,
  };
  const res = await query(
    `UPDATE npcs SET flags = COALESCE(flags, '{}'::jsonb) || jsonb_build_object('gift_trade', $1::jsonb)
     WHERE id = 'npc_nyra_voss'`,
    [JSON.stringify(giftTrade)]
  );
  console.log(res.rowCount ? '✓ Nyra Voss gift trade wired (cigarette → Psychotech cassette)' : '⚠ npc_nyra_voss not found — gift trade not wired');

  console.log('\nDone. Restart the server (or reload the world) so Nyra\'s flags load into memory.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
