// One-shot content: seed first-visit "intro lore" onto a handful of marquee
// areas. This is the tone-setting block a *new account* sees the first time it
// looks at one of these zones — history, who runs it now, what to watch for, and
// the plain fact that it's dog-eat-dog out here. It shimmers in (client
// `.intro-lore`) before settling to normal prose.
//
//   Run once (local):  node scripts/add-intro-lore.js
//   Against prod:       node --env-file=.env.prod scripts/add-intro-lore.js
//   Then restart / hit /world/reload so the zone flags are re-cached.
//
// The behaviour (who's eligible, once-per-zone) is owned by the `lore` plugin;
// this script only authors the prose, stored in zones.flags.intro_lore. It's the
// sanctioned data-transformation path (writes an existing column on existing
// rows). Idempotent: re-running just re-applies the latest text, and it merges
// into flags rather than clobbering other keys. Author more entries here or in
// the dev panel zone editor's flags — any zone with flags.intro_lore participates.
import { query } from '../server/models/db.js';

// zone_id -> the intro block. Keep it a few sentences: set the tone, don't wall
// off the screen. This is a starter set for the newest areas; extend freely.
const LORE = {
  zone_ruins:
    "Old Coldwater was a real city once — banks, permits, people who thought the lights would stay on. The Handoff ended all of that in an afternoon. Now the towers are quarries and the only law is whoever's standing over you. Salvage what you can carry, trust no promise made in daylight, and never assume an empty street is empty.",

  zone_civ_steps:
    "These steps used to mean the city cared what happened to you — records, hearings, a stamp that said you existed. The office behind them still runs, after a fashion, but it works for whoever pays it now. Watch the landings. What looks like pigeons is sometimes lookouts, and the water at the bottom keeps its own secrets.",

  zone_slag_gate:
    "COLDWATER RECLAMATION owned everything past this fence — the furnaces, the fill, the men who fed both. The company's long gone; the appetite it built into this place isn't. Salvage crews and worse work the Slagworks now, and out here 'authorised personnel' just means whoever showed up armed. Mind the ground, mind the rats, mind the people who aren't rats.",

  zone_tunnels:
    "The Under belongs to the Archivists, and the Archivists belong to the dark. They keep the old words down here — newsprint, manuals, names of the dead — because up top nobody remembers on purpose. They'll trade in knowledge and let you pass for it. Break their peace and the tunnels close around you, and the amber light is a long way from the surface.",

  zone_red_redline:
    "This is where the map gives up. Past the skull-stakes the readings climb until they lie, and everything that still moves out here has decided to. The Redline doesn't have owners; it has victims and the things that made them. There's a reason it's the corner of the world nobody claims. If you're standing here without a plan to leave, you already made a mistake.",

  // ── Starting district ─────────────────────────────────────────────────────
  // The clone facility a new print wakes in, and the full 5×5 world-map window
  // around the Franchise Strip (zone_city_west) where players get their start.
  // This is the block that sets the tone in the first ten minutes.

  // Clone facility interior — the first three rooms anyone ever sees.
  zone_start:
    "Welcome to the only birth you'll get. The vat behind you printed you off a backup nobody bothered to keep current, and the receipt it spat out is the closest thing you have to family. Coldwater doesn't care that you're new — the second you step outside you're just another mouth the basin didn't ask for. What you can carry, you keep. Everything else was always going to be somebody else's.",
  zone_clone_facility_bathroom:
    "A clone-facility bathroom, which means it works about as well as everything else Coldwater kept running out of habit. The mirror's been scratched half-blind by a hundred other versions of somebody working out what they look like now. Wash up if you want — the water's real, mostly. Nobody's coming to check on you, and this is the last privacy you'll get for free.",
  'zone_clone_facility_z-1_1782276270002':
    "Below the print floor, where the facility keeps the machinery that makes new people and the tanks that quietly dispose of the failed attempts. It hums with power the rest of the block would knife each other for. The Custodians tolerate this place because it still, technically, serves the city — step wrong down here and you'll learn how thin 'technically' is.",

  // World map — the 25 tiles around the Franchise Strip.
  zone_civ_meltwater:
    "Clean water is the one thing the basin can't fake, so every morning a line forms at these taps and holds its own small court. The queue has rules older than the Handoff and enforces them without a single guard in sight. Cut it, and you'll find out that dying of thirst is the slow option.",
  zone_up_aid:
    "Someone keeps this triage kiosk running on expired supplies and pure spite, which in Coldwater is close enough to sainthood. They'll patch you for a price or a favor, and the favor is always worse than the price. Don't mistake the kindness for safety — whoever's bandaging you is still keeping score.",
  zone_powerplantnew:
    "The ground here still runs warm, bleeding heat off something underneath that nobody ever shut down. People sleep on the Flats in winter and some of them don't wake up — the warmth lies about how much it's taking back. The Franchise claims the output; you're welcome to the runoff and whatever it does to you.",
  zone_ext_1782953094650:
    "Floodlit at all hours by lights nobody remembers installing, this yard sits behind the broadcast blocks like a stage waiting on a crime. The cameras here actually work, which is rarer than it ought to be. Do your worst somewhere darker — on the Limelight Lot the whole city is a witness, and half of them are for sale.",
  zone_up_gate:
    "This is where the money starts, and money in Coldwater means a wall, a checkpoint, and men paid to make you feel the difference. Uptown keeps its lights on and its problems out, and you are, unmistakably, a problem. Have your reasons ready and your hands where they can be seen — the politeness here is a countdown.",
  zone_civ_sortation:
    "A sorting belt still crawls through here, routing parcels to addresses that burned down before you were printed. Scavengers work the dead letters for whatever the machine misfiled — sometimes credits, sometimes a debt with your name freshly on it. The belt doesn't stop for anyone, and people have left pieces behind proving it.",
  zone_warehouse:
    "The Franchise moves everything worth moving through these bays, which makes it the basin's beating heart and just as easy to stab. Everything here belongs to somebody, and that somebody has people. Lift the wrong crate and you won't be robbed — you'll be made an example, and examples in Coldwater don't get sequels.",
  zone_city_east:
    "More Franchise distribution, more forklifts hauling pallets between men who'd sell each other for the manifest. Honest work, if you can stomach who you're working for; dishonest opportunity, if you're quicker than their bookkeeping. Either way the Franchise sees the numbers before you do.",
  zone_city_north:
    "Dead streetlights stand at attention over a plaza that hasn't hosted anything but muggings in years. This is where a lot of fresh prints wander first, blinking in the light — which is exactly why the people who feed on fresh prints wait here. Keep moving. Standing still on the Threshold reads as an invitation.",
  zone_city_ne:
    "The Custodians still polish these half-empty spires for an employer that stopped existing at the Handoff, and they'll defend them from you with lethal, cheerful devotion. They believe someone's coming back to check the work. Humor them, or better, avoid them — a machine that never got the memo it lost is the most dangerous thing in the basin.",
  zone_badland_w_gate:
    "The old processing yards die here in a maze of collapsed sheds and gantries rusted shut mid-motion. It's quiet, which in Coldwater is never good news — quiet means nobody's found a reason to be here, or everyone who did is under the rust. Watch your footing and your back; the Quarter keeps what falls into it.",
  zone_outskirts:
    "Enormous processing facilities stand exactly where the last shift left them, decades cold, too big to loot and too broken to use. People hole up out here because nobody bothers to look — which means everyone you meet is also hiding from something. Do that math before you trust the next face you see.",
  zone_city_west:
    "Big-box skeletons and pre-Handoff storefronts, fought over so long that the fighting became the economy. The Franchise runs the Strip the way rot runs a wound: thoroughly, and like it belongs there. It's the safest place a new print will find to earn their first honest credits — which should tell you everything about how the rest of the basin goes.",
  zone_threshold:
    "The city's broken spine — a boulevard sagging east under dead lights and dead lines, where every district's traffic has to pass and everyone watches who does. It's neutral ground only because nobody's managed to hold it yet. You'll cross the Threshold a hundred times; the trick is making it a hundred and one.",
  zone_thresholdeast:
    "East, the buildings lean in and the sky gets rationed between them. That crowding is a kind of ownership — someone up in those windows watches this stretch and taxes it in ways you won't see coming. Move like you're expected and you might just be left alone.",
  zone_deep_waste:
    "This is the edge past which Coldwater stopped pretending. The last blocks of Old Coldwater have folded into their own basements, and whatever lives down in the crease has no interest in your credits. There's salvage here for the desperate, and the desperate are the only ones who come — work out what that makes you.",
  zone_badland_sw_outer:
    "A municipal park gone feral, its trees grown into crooked shapes over something in the soil that hums when it rains. People slip into the Static Wood for privacy and a surprising number don't come back out with all of it. It's beautiful, in the wrong light. That's usually the last thing they think.",
  zone_city_sw:
    "A guarded stairwell down into the old subway, where the Archivists keep the real vault — everything the surface agreed to forget. They'll let you descend if you've got something worth trading, and what they trade in is knowledge, always knowledge. Come empty-handed or come armed and you'll find the dark down there has staff.",
  zone_city_south:
    "The chokepoint where the vertical Sprawl bleeds into the rest of the city, strung with laundry lines and extension cords stealing power off the grid. Everyone passing through is either going home to the Sprawl or running from it, and both kinds are watching their pockets. The Gate remembers faces — give it a forgettable one.",
  zone_city_se:
    "One of the few medical points in the basin that's actually staffed, which makes it holy ground: people are polite here because everyone eventually bleeds and nobody's above needing it. Start something on the Clinic Block and the whole block finishes it. It's the closest thing to law you'll find, and it stops at the sidewalk.",
  zone_deep_tarpit:
    "Where the Undermarket's runoff pools into a black seep of tar and worse, worked by people with nothing left to ruin. Whatever the market upstream won't touch ends up down here, sometimes including people. The fumes lie to you slowly and the diggers lie to you fast. Bring a reason to leave before you arrive.",
  zone_deep_warrens:
    "The Sprawl's foundations have rotted into a maze of lean-tos and tarp stalls where everything's for sale and nothing has a fixed price but your life. The Warrens run on favors, grudges, and the quiet certainty that the person beside you would trade you for dinner. They might be right. Keep your hands where you can see everyone else's.",
  zone_deep_cardboard:
    "A gutter of flattened appliance boxes and pallet-wood shanties, cook-fires guttering in oil drums, everyone one bad night from the tarpit. Nobody here has anything, which is exactly what makes the little they do have worth killing over. Charity is a con and pity is a tell — on Cardboard Row, both get you emptied.",
  zone_slums:
    "Pre-Handoff apartment towers stacked with improvised floors until they groan — loud, dense, vertical, and home to most of the basin that isn't dead yet. The Sprawl polices itself in ways you won't understand until you've broken one of its rules. Rent is cheap; the neighbors are the price.",
  zone_deep_scab:
    "A knife-narrow cut between tenements, the floor slick with the aftermath of deals that went the usual way. This is where you buy what the Strip won't sell you, and where you learn the buyer and the mark are the same chair. Walk it fast, walk it once, and never count your money where the walls can see.",
};

async function main() {
  let applied = 0, missing = 0;
  for (const [zoneId, lore] of Object.entries(LORE)) {
    // Merge into flags so we never stomp other zone flags. jsonb_set on a text value.
    const { rowCount } = await query(
      `UPDATE zones
         SET flags = COALESCE(flags, '{}'::jsonb) || jsonb_build_object('intro_lore', $2::text)
       WHERE id = $1`,
      [zoneId, lore]
    );
    if (rowCount) { applied++; console.log(`  ✓ ${zoneId}`); }
    else { missing++; console.log(`  – ${zoneId} (no such zone here, skipped)`); }
  }
  console.log(`\nintro-lore: ${applied} zone(s) updated, ${missing} skipped.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
