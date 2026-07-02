// One-shot seed for the expanded drugs catalogue + hallucination dream-zones.
//
//   node server/models/temp/seed-drugs.js           # seed (skips ids already present)
//   node server/models/temp/seed-drugs.js --force    # wipe seeded drugs/items/zones and reseed
//
// Deliberate, run-once. After this the content lives in the DB and is edited via
// the dev panel (Drugs editor). Requires `npm run db:schema` (and the
// alter-drug-state one-shot on existing DBs) so the new columns exist.
//
// The `effects` JSON schema (all sub-blocks optional) is documented in
// server/engine/drugs.js. Back-compat: a flat effects object with none of the
// structured keys is treated as an `instant` block.

import 'dotenv/config';
import { query, getClient } from '../db.js';

// ── Dream zones (isolated, off the world map) ────────────────────────────────
// map_id 'map_dream' + flags.is_dreamzone keeps them off the minimap and lets
// the login rescue bounce anyone stranded by a restart. No exits: the player is
// held until the trip ends and the plugin teleports them back.
const DREAM_ZONES = [
  {
    id: 'zone_dream_threshold',
    name: 'The Threshold',
    description: 'There is no floor and there is no ceiling and yet you are standing. Fractal architecture unfolds in every direction, breathing, made of light that has weight. Vast machine-elves of chrome and stained glass turn to regard you without eyes. A sound like a cathedral being tuned rolls through your chest. You understand everything. You will remember none of it.',
  },
  {
    id: 'zone_dream_khole',
    name: 'The K-Hole',
    description: 'You have become very far away from yourself. Your body is a rumour someone told you once. The world is a smooth grey funnel and you are sliding down the inside of it, slowly, without fear, without much of anything. Distant shapes move like continents. Time has been folded into a small flat square and put away.',
  },
  {
    id: 'zone_dream_void',
    name: 'The Static Sea',
    description: 'An ocean of soft blue static stretches past every horizon. It laps at your ankles and hums your name in a voice you almost recognise. Things swim beneath the surface — old memories wearing new bodies, advertisements for products that do not exist, the shape of a room you grew up in. None of it is quite solid. All of it is watching.',
  },
];

// ── Drug catalogue ───────────────────────────────────────────────────────────
// Each entry authors one drug + its linked item. key → drug_id `drug_<key>` and
// item_id `item_<key>`.
const DRUGS = [
  // ── Stimulants ──
  {
    key: 'buzz', name: 'Buzz', value: 40, rarity: 'common',
    desc: 'A cheap street stim in a cracked ampoule. Hits fast, fades faster.',
    duration: 180, addiction: 0.12, od: 4,
    effects: {
      instant: { sanity: 8, hunger: -4 },
      phases: { comeup_seconds: 15, peak_seconds: 90, comedown_seconds: 45, comeup_scale: 0.5, comedown_scale: 0.4,
        peak_mods: { stat_reflexes: 2, stamina_regen_per_sec: 1 },
        peak_message: '<span class="msg-system">Everything sharpens. You could run for a bus that left an hour ago.</span>',
        end_message: '<span class="msg-system">The buzz thins out into a dull grey headache.</span>' },
      tolerance: { gain_per_dose: 0.08, max_reduction: 0.6 },
      overdose: { lethal: true, message: 'Your heart trips over itself once, twice, and stops.' },
    },
  },
  {
    key: 'redline', name: 'Redline', value: 120, rarity: 'uncommon',
    desc: 'Military-grade cyber-amphetamine. The label is mostly warnings.',
    duration: 300, addiction: 0.28, od: 3,
    effects: {
      instant: { sanity: 12, hunger: -8, thirst: -6 },
      phases: { comeup_seconds: 20, peak_seconds: 150, comedown_seconds: 90, comeup_scale: 0.4, comedown_scale: 0.5,
        peak_mods: { stat_brawn: 3, stat_reflexes: 3, hp_max: 15, stamina_regen_per_sec: 2 },
        comeup_message: '<span class="msg-system">Your pulse redlines. The world drops into slow motion.</span>',
        peak_message: '<span class="msg-system">You are made of wire and lightning. Nothing can touch you.</span>',
        comedown_message: '<span class="msg-system">The wire goes slack. Your hands start to shake.</span>',
        end_message: '<span class="msg-system">The crash lands on you like a dropped ceiling.</span>' },
      tolerance: { gain_per_dose: 0.12, recovery_per_sec: 0.0002, max_reduction: 0.7 },
      withdrawal: { onset_seconds: 900, mods: { stat_reflexes: -2, stat_cool: -2 }, message: 'Your teeth won\'t stop grinding. You need another hit.' },
      overdose: { lethal: true, message: 'Your heart is a fist clenching until it cannot open again.' },
    },
  },
  {
    key: 'coldfire', name: 'Coldfire', value: 260, rarity: 'rare',
    desc: 'A combat stim that turns fear into fuel. Frontline mercs swear by it, and at it.',
    duration: 240, addiction: 0.35, od: 3,
    effects: {
      instant: { sanity: 6, hunger: -12 },
      phases: { comeup_seconds: 10, peak_seconds: 140, comedown_seconds: 90, comeup_scale: 0.6, comedown_scale: 0.6,
        peak_mods: { stat_brawn: 5, stat_endurance: 3, hp_max: 30, hp_regen_per_sec: 1 },
        peak_message: '<span class="msg-system">Cold fire floods your veins. Pain becomes a distant rumour.</span>',
        end_message: '<span class="msg-system">The fire gutters out. Every wound you ignored is suddenly very loud.</span>' },
      tolerance: { gain_per_dose: 0.15, max_reduction: 0.7 },
      withdrawal: { onset_seconds: 1200, mods: { stat_brawn: -3, stat_endurance: -2 }, message: 'Everything aches. Coldfire fixes that. Coldfire fixes everything.' },
      overdose: { lethal: true, message: 'Your body cannot tell it is dying. It sprints straight past the edge.' },
    },
  },
  {
    key: 'static', name: 'Static', value: 90, rarity: 'uncommon',
    desc: 'A nootropic mist for the overclocked mind. Clarity in a can, with interest.',
    duration: 360, addiction: 0.18, od: 4,
    effects: {
      instant: { sanity: 10 },
      phases: { comeup_seconds: 30, peak_seconds: 240, comedown_seconds: 90, comeup_scale: 0.5, comedown_scale: 0.5,
        peak_mods: { stat_brains: 4, sanity_regen_per_sec: 1 },
        peak_message: '<span class="msg-system">The static clears. You can see the shape of every problem at once.</span>',
        end_message: '<span class="msg-system">The signal degrades. Thoughts go grainy again.</span>' },
      tolerance: { gain_per_dose: 0.1, max_reduction: 0.6 },
      overdose: { lethal: true, message: 'Too much signal, no more silence. Your mind whites out and does not come back.' },
    },
  },

  // ── Opioids / downers ──
  {
    key: 'grey', name: 'Grey', value: 150, rarity: 'uncommon',
    desc: 'Synthetic morphine in a grey gelcap. The pain goes away. So does everything else.',
    duration: 420, addiction: 0.45, od: 3,
    effects: {
      instant: { sanity: 14 },
      phases: { comeup_seconds: 25, peak_seconds: 240, comedown_seconds: 150, comeup_scale: 0.5, comedown_scale: 0.5,
        peak_mods: { hp_regen_per_sec: 2, stat_reflexes: -3, stat_cool: 2 },
        comeup_message: '<span class="msg-system">A warm grey tide rolls up from your feet. Nothing hurts.</span>',
        peak_message: '<span class="msg-system">You are floating in warm water in a dark, kind room.</span>',
        end_message: '<span class="msg-system">The warmth recedes and leaves you cold and small on the shore.</span>' },
      tolerance: { gain_per_dose: 0.14, recovery_per_sec: 0.00015, max_reduction: 0.75 },
      withdrawal: { onset_seconds: 600, mods: { hp_max: -15, stat_endurance: -3, stat_cool: -3 }, message: 'Your skin crawls, your bones ache, and the whole world is a hand held out for more grey.' },
      overdose: { lethal: true, message: 'Your breathing slows, and slows, and forgets how.' },
    },
  },
  {
    key: 'blacktar', name: 'Blacktar', value: 210, rarity: 'rare',
    desc: 'Heavy tar opioid, cut with whatever was nearby. The deepest nod there is.',
    duration: 480, addiction: 0.6, od: 2,
    effects: {
      instant: { sanity: 18, hunger: -6 },
      phases: { comeup_seconds: 20, peak_seconds: 300, comedown_seconds: 160, comeup_scale: 0.6, comedown_scale: 0.6,
        peak_mods: { hp_regen_per_sec: 3, stat_reflexes: -5, stat_brains: -3 },
        peak_message: '<span class="msg-system">You go under. The tar closes over your head, black and total and perfect.</span>',
        end_message: '<span class="msg-system">You surface, gasping, into a world that got worse while you were gone.</span>' },
      tolerance: { gain_per_dose: 0.18, recovery_per_sec: 0.0001, max_reduction: 0.8 },
      withdrawal: { onset_seconds: 480, mods: { hp_max: -25, stat_brawn: -3, stat_endurance: -4, stat_cool: -4 }, message: 'Withdrawal has you by the spine. You would trade almost anything to make it stop.' },
      overdose: { lethal: true, message: 'The nod goes all the way down and does not turn around.' },
    },
  },
  {
    key: 'lull', name: 'Lull', value: 70, rarity: 'common',
    desc: 'A blue benzo tab that files the sharp edges off a bad night.',
    duration: 360, addiction: 0.3, od: 3,
    effects: {
      instant: { sanity: 16 },
      phases: { comeup_seconds: 30, peak_seconds: 240, comedown_seconds: 90, comeup_scale: 0.5, comedown_scale: 0.5,
        peak_mods: { stat_cool: 3, stat_reflexes: -2, sanity_regen_per_sec: 1 },
        peak_message: '<span class="msg-system">The panic unclenches. Whatever it was, it can wait.</span>',
        end_message: '<span class="msg-system">The calm wears thin and the worries file back in.</span>' },
      tolerance: { gain_per_dose: 0.12, max_reduction: 0.7 },
      withdrawal: { onset_seconds: 900, mods: { stat_cool: -3, sanity_regen_per_sec: -1 }, message: 'Your nerves are live wires again. You remember exactly what fixes that.' },
      overdose: { lethal: true, message: 'You lie down to rest your eyes for just a second, and never open them.' },
    },
  },

  // ── Psychedelics (overlay hallucinations) ──
  {
    key: 'psilocybin', name: 'Psilocybin', value: 60, rarity: 'common',
    desc: 'A handful of wrinkled grey mushrooms grown in somebody\'s ventilation duct.',
    duration: 240, addiction: 0.02, od: 6,
    effects: {
      instant: { sanity: -4 },
      hallucination: { mode: 'overlay', intensity: 0.5, palette: 'purple', duration_seconds: 240, eventEverySec: 12,
        eventPool: [
          '[trip]The walls take a slow, deliberate breath.[/trip]',
          '[trip]The floor is a carpet of soft breathing moss now. It doesn\'t mind you standing on it.[/trip]',
          '[trip]Every surface is faintly patterned with eyes, all of them kind.[/trip]',
          '[trip]You can hear the colour green. It sounds like your grandmother\'s kitchen.[/trip]',
          '[trip]Time pools in the corners of the room like warm honey.[/trip]',
          '[trip]A shaft of light bends toward you and asks, without words, if you are okay.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.3, recovery_per_sec: 0.0003, max_reduction: 0.9 },
    },
  },
  {
    key: 'blotter', name: 'Blotter', value: 130, rarity: 'uncommon',
    desc: 'A single square of high-powered blotter acid, printed with a grinning sun.',
    duration: 600, addiction: 0.01, od: 8,
    effects: {
      instant: { sanity: -8 },
      hallucination: { mode: 'overlay', intensity: 0.8, palette: 'magenta', duration_seconds: 600, eventEverySec: 14,
        eventPool: [
          '[trip]The room inhales and the walls flow outward into cathedral vaults of liquid light.[/trip]',
          '[trip]Fractal vines of every impossible colour crawl up from the floor and flower midair.[/trip]',
          '[trip]Your own hands leave glowing trails, a hundred hands fanning out from your wrists.[/trip]',
          '[trip]Sound has texture. A distant machine hum is velvet dragged across your teeth.[/trip]',
          '[trip]The grinning sun from the tab is on the ceiling now, and it winks at you.[/trip]',
          '[trip]You are absolutely certain, for one perfect second, that you understand it all.[/trip]',
          '[trip]A stranger who is also you steps out of the wall, waves, and folds back in.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.4, recovery_per_sec: 0.0002, max_reduction: 0.95 },
    },
  },
  {
    key: 'mescaline', name: 'Mescaline', value: 110, rarity: 'uncommon',
    desc: 'Seventy-five pellets rattle in a little tin. You only need a few.',
    duration: 480, addiction: 0.02, od: 6,
    effects: {
      instant: { sanity: -6, hunger: -6 },
      hallucination: { mode: 'overlay', intensity: 0.7, palette: 'gold', duration_seconds: 480, eventEverySec: 13,
        eventPool: [
          '[trip]Everything is edged in shimmering gold, as if the world were a coin held to the light.[/trip]',
          '[trip]Geometric patterns bloom across every wall, precise and ancient and alive.[/trip]',
          '[trip]Your stomach rolls, but the nausea is just the door you have to walk through.[/trip]',
          '[trip]A desert wind you cannot feel moves the shadows in long slow waves.[/trip]',
          '[trip]An old voice, patient as stone, tells you a story in a language you were born knowing.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.3, max_reduction: 0.9 },
    },
  },
  {
    key: 'screamers', name: 'Screamers', value: 100, rarity: 'uncommon',
    desc: 'A designer psychedelic that does not do gentle. Roll the dice.',
    duration: 300, addiction: 0.08, od: 5,
    effects: {
      instant: { sanity: -18 },
      hallucination: { mode: 'overlay', intensity: 1.0, palette: 'red', duration_seconds: 300, eventEverySec: 10,
        eventPool: [
          '[trip]The walls are the wrong colour. They know they are the wrong colour. They are furious about it.[/trip]',
          '[trip]Something enormous is screaming just below the range of hearing and it is getting closer.[/trip]',
          '[trip]Your reflection in every surface is a half-second behind you, and grinning.[/trip]',
          '[trip]The floor tilts. The ceiling drips. None of it is trying to help you.[/trip]',
          '[trip]You are being watched by the architecture and it does not like what it sees.[/trip]',
          '[trip]For a moment you are certain you have always been here and will never leave.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.25, max_reduction: 0.85 },
    },
  },
  {
    key: 'laughers', name: 'Laughers', value: 85, rarity: 'common',
    desc: 'Little yellow tabs that turn the apocalypse into the funniest thing you have ever seen.',
    duration: 240, addiction: 0.1, od: 5,
    effects: {
      instant: { sanity: 20 },
      hallucination: { mode: 'overlay', intensity: 0.5, palette: 'gold', duration_seconds: 240, eventEverySec: 12,
        eventPool: [
          '[trip]The sheer absurdity of everything hits you and you have to lean on a wall, wheezing.[/trip]',
          '[trip]That grim little machine in the corner looks, on reflection, deeply and hilariously stupid.[/trip]',
          '[trip]Someone somewhere is taking all of this seriously and that is the funniest part.[/trip]',
          '[trip]You catch your own reflection making a face and completely lose it.[/trip]',
          '[trip]Even the dread feels like a joke with a punchline you already know.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.2, max_reduction: 0.8 },
    },
  },
  {
    key: 'dreamsmoke', name: 'Dreamsmoke', value: 45, rarity: 'common',
    desc: 'Two bags of engineered grass. Mellow, hungry, harmless-ish.',
    duration: 300, addiction: 0.08, od: 8,
    effects: {
      instant: { sanity: 12, hunger: 15, thirst: 6 },
      phases: { comeup_seconds: 20, peak_seconds: 200, comedown_seconds: 80, comeup_scale: 0.5, comedown_scale: 0.5,
        peak_mods: { stat_cool: 2, stat_reflexes: -1 },
        peak_message: '<span class="msg-system">A soft heaviness settles over you. The edges of the room go plush.</span>',
        end_message: '<span class="msg-system">The mellow lifts. You are mostly just hungry now.</span>' },
      hallucination: { mode: 'overlay', intensity: 0.3, palette: 'green', duration_seconds: 300, eventEverySec: 20,
        eventPool: [
          '[trip]Time slows to a comfortable crawl. There is nowhere you need to be.[/trip]',
          '[trip]You become deeply, urgently aware that you would demolish an entire vending machine of snacks.[/trip]',
          '[trip]A thought drifts by, profound and important, and you completely fail to catch it.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.15, max_reduction: 0.7 },
    },
  },
  {
    key: 'ether', name: 'Ether', value: 30, rarity: 'common',
    desc: 'A pint of raw ether and a rag. Not the smart choice, but here we are.',
    duration: 120, addiction: 0.15, od: 3,
    effects: {
      instant: { sanity: -10 },
      hallucination: { mode: 'overlay', intensity: 0.6, palette: 'cyan', duration_seconds: 120, eventEverySec: 10,
        eventPool: [
          '[trip]The floor lurches sideways and the room smears into long cold streaks.[/trip]',
          '[trip]Your thoughts arrive out of order, each one wrapped in cotton wool.[/trip]',
          '[trip]You are extremely far away from your own hands.[/trip]',
          '[trip]A chemical wind blows straight through your skull and out the other side.[/trip]',
        ] },
      overdose: { lethal: true, message: 'You breathe in one rag too many. The lights go out mid-thought.' },
    },
  },

  // ── Dissociatives (dream-zone hallucinations) ──
  {
    key: 'threshold', name: 'The Threshold', value: 400, rarity: 'rare',
    desc: 'A single breath of vaporised DMT-analog. Ten thousand years in four hundred seconds.',
    duration: 200, addiction: 0.01, od: 6,
    effects: {
      instant: { sanity: -12 },
      hallucination: { mode: 'dreamzone', dreamzone_id: 'zone_dream_threshold', intensity: 1.0, palette: 'magenta', duration_seconds: 180, eventEverySec: 20,
        events: [
          { atSec: 4, text: '[trip]The room peels away like wet paper and you fall UP through it.[/trip]' },
          { atSec: 30, text: '[trip]The machine-elves are showing you something. It is the most important thing there is.[/trip]' },
          { atSec: 80, text: '[trip]You have been here before. You have always been here. You live here.[/trip]' },
          { atSec: 140, text: '[trip]The cathedral begins, very gently, to fold you back up and post you home.[/trip]' },
        ] },
      tolerance: { gain_per_dose: 0.2, max_reduction: 0.6 },
    },
  },
  {
    key: 'khole', name: 'K-Hole', value: 180, rarity: 'uncommon',
    desc: 'A dissociative dust that unplugs you from your own body for a while.',
    duration: 240, addiction: 0.12, od: 4,
    effects: {
      instant: { sanity: -8 },
      hallucination: { mode: 'dreamzone', dreamzone_id: 'zone_dream_khole', intensity: 0.7, palette: 'blue', duration_seconds: 200, eventEverySec: 18,
        eventPool: [
          '[trip]You slide a little further down the smooth grey funnel.[/trip]',
          '[trip]Your body is somewhere behind you now, waving. You wave back, or think about it.[/trip]',
          '[trip]Continents of thought drift past, too large and too slow to be afraid of.[/trip]',
          '[trip]Someone is speaking. It might be you. It was a long time ago.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.2, max_reduction: 0.8 },
      withdrawal: { onset_seconds: 1800, mods: { stat_brains: -2 }, message: 'The grey funnel calls. You keep glancing toward the door that isn\'t there.' },
      overdose: { lethal: true, message: 'You go so far down the hole that you forget the way back, and your body forgets to breathe.' },
    },
  },
  {
    key: 'voidwalk', name: 'Voidwalk', value: 300, rarity: 'rare',
    desc: 'A designer dissociative that drops you into the static between channels.',
    duration: 300, addiction: 0.1, od: 4,
    effects: {
      instant: { sanity: -14 },
      hallucination: { mode: 'dreamzone', dreamzone_id: 'zone_dream_void', intensity: 0.9, palette: 'cyan', duration_seconds: 260, eventEverySec: 20,
        eventPool: [
          '[trip]The static sea hums your name and you feel it in your back teeth.[/trip]',
          '[trip]A memory swims past wearing someone else\'s face. It nods at you.[/trip]',
          '[trip]An advertisement for a product that does not exist plays across the whole sky.[/trip]',
          '[trip]You wade deeper. The blue closes over your knees, your chest, your reasons for leaving.[/trip]',
        ] },
      tolerance: { gain_per_dose: 0.2, max_reduction: 0.8 },
      overdose: { lethal: true, message: 'The static pulls you all the way under and keeps the channel dark.' },
    },
  },

  // ── Designer / cyberpunk ──
  {
    key: 'overclock', name: 'Neural Overclock', value: 350, rarity: 'rare',
    desc: 'A lace-booster that runs your wetware past the red line. Smoke may be metaphorical.',
    duration: 240, addiction: 0.3, od: 3,
    effects: {
      instant: { sanity: -6 },
      phases: { comeup_seconds: 12, peak_seconds: 150, comedown_seconds: 78, comeup_scale: 0.5, comedown_scale: 0.6,
        peak_mods: { stat_brains: 5, stat_reflexes: 4, hp_max: 10, sanity_regen_per_sec: -1 },
        comeup_message: '<span class="msg-system">Your lace spins up with a whine only you can hear. The world turns to data.</span>',
        peak_message: '<span class="msg-system">You are thinking in parallel now, a dozen threads, all of them screaming.</span>',
        end_message: '<span class="msg-system">The clock drops back to baseline. Your skull throbs where the heat pooled.</span>' },
      tolerance: { gain_per_dose: 0.14, max_reduction: 0.7 },
      withdrawal: { onset_seconds: 900, mods: { stat_brains: -3, stat_reflexes: -2 }, message: 'Baseline feels like wading through mud. You want the clock back up.' },
      overdose: { lethal: true, message: 'Your wetware runs too hot for too long and something delicate inside simply melts.' },
    },
  },
  {
    key: 'memhack', name: 'Memhack', value: 220, rarity: 'rare',
    desc: 'A memory-editing synth. Sands the barbs off your worst recollections. Mostly.',
    duration: 360, addiction: 0.2, od: 4,
    effects: {
      instant: { sanity: 24 },
      phases: { comeup_seconds: 30, peak_seconds: 240, comedown_seconds: 90, comeup_scale: 0.5, comedown_scale: 0.5,
        peak_mods: { stat_cool: 3, sanity_regen_per_sec: 1 },
        peak_message: '<span class="msg-system">Old wounds you carry go soft and distant, like they happened to someone else.</span>',
        end_message: '<span class="msg-system">The edits settle. A few of the barbs quietly grow back.</span>' },
      tolerance: { gain_per_dose: 0.12, max_reduction: 0.7 },
      withdrawal: { onset_seconds: 1200, mods: { sanity_regen_per_sec: -1, stat_cool: -2 }, message: 'The memories come back sharp and all at once. Only memhack files them down.' },
      overdose: { lethal: true, message: 'It edits one memory too many — the one where your heart remembers to beat.' },
    },
  },
  {
    key: 'amyls', name: 'Amyls', value: 25, rarity: 'common',
    desc: 'Two dozen amyls in a rattling little box. A brief, roaring rush.',
    duration: 60, addiction: 0.1, od: 4,
    effects: {
      instant: { sanity: 6, horniness_increase: 25 },
      phases: { comeup_seconds: 4, peak_seconds: 30, comedown_seconds: 26, comeup_scale: 0.8, comedown_scale: 0.5,
        peak_mods: { stat_brawn: 2, stat_reflexes: 2 },
        comeup_message: '<span class="msg-system">A hot rush slams up the back of your neck and the room goes bright and loud.</span>',
        end_message: '<span class="msg-system">The rush drops out from under you as fast as it came.</span>' },
      tolerance: { gain_per_dose: 0.2, max_reduction: 0.7 },
      overdose: { lethal: true, message: 'One popper too many and your blood pressure bottoms out. You fold like a chair.' },
    },
  },
];

const force = process.argv.includes('--force');
const client = await getClient();

const ITEM_TYPE = 'consumable';

try {
  await client.query('BEGIN');

  if (force) {
    const drugIds = DRUGS.map(d => `drug_${d.key}`);
    const itemIds = DRUGS.map(d => `item_${d.key}`);
    const zoneIds = DREAM_ZONES.map(z => z.id);
    await client.query('DELETE FROM drugs WHERE id = ANY($1)', [drugIds]);
    await client.query('DELETE FROM items WHERE id = ANY($1)', [itemIds]);
    await client.query('DELETE FROM zones WHERE id = ANY($1)', [zoneIds]);
  }

  // Dream zones.
  for (const z of DREAM_ZONES) {
    await client.query(
      `INSERT INTO zones (id, name, description, danger_rating, is_safe_zone, pvp_enabled, exits, flags, map_id)
       VALUES ($1,$2,$3,'safe',1,0,'{}'::jsonb,$4,'map_dream')
       ON CONFLICT (id) DO NOTHING`,
      [z.id, z.name, z.description, JSON.stringify({ is_dreamzone: true, is_interior: true })]
    );
  }

  // Items + drugs.
  let n = 0;
  for (const d of DRUGS) {
    const itemId = `item_${d.key}`;
    const drugId = `drug_${d.key}`;
    await client.query(
      `INSERT INTO items (id, name, description, type, subtype, weight, value, rarity, is_stackable, tags)
       VALUES ($1,$2,$3,$4,'drug',20,$5,$6,1,$7::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [itemId, d.name, d.desc, ITEM_TYPE, d.value, d.rarity, JSON.stringify({ drug: true })]
    );
    await client.query(
      `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'{}'::jsonb,'{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [drugId, d.name, d.desc, itemId, d.duration, JSON.stringify(d.effects), d.addiction, d.od]
    );
    n++;
  }

  await client.query('COMMIT');
  console.log(`✓ Seeded ${n} drugs (+items) and ${DREAM_ZONES.length} dream zones.`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('✗ seed failed:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  process.exit();
}
