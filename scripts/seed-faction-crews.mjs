// One-shot content seed: gives three flagship NPC factions a living crew of
// stationary presence NPCs. Idempotent (deterministic ids, ON CONFLICT DO NOTHING).
//
//   node scripts/seed-faction-crews.mjs
//
// NPCs are fully specified (npc_type/sex/clothing_layers/hp) so the direct insert
// loses none of apiCreateNpc's derivation. A server restart (or /world reload)
// loads the new NPCs into world.npcs.
//
// The base factions no longer hold or acquire territory — that scheme was retired
// as they become standalone ideologies, so this script only seeds NPCs now
// (`zone_control` belongs to player corps alone).
import { query } from '../server/models/db.js';

// Every NPC: stationary faction presence (wanders 0, no behaviour graph),
// bespoke gendered clothing, chitchat that telegraphs "this is our ground."
const NPCS = [
  // ── THE BREAKERS ─ wasteland gang, anti-tech, Slaughter Lane ──
  { id: 'npc_breaker_sledge', name: 'Sledge Vurn', sex: 'male', hp: 130, faction: 'faction_breakers', zone: 'zone_meat_slaughter',
    personality: 'lowlife',
    clothing: ['a battle-jacket riveted with road-signs and bike chain', 'a grease-black wifebeater', 'torn canvas work shorts'],
    desc: "A slab of a man gone to rust, Sledge runs the Breakers' end of Slaughter Lane with a length of rebar and a grudge against anything that beeps. Half his face is a burn scar shaped like a circuit board — a souvenir, he'll tell you, from teaching a drone some manners. He does not blink much.",
    chit: ['drags his rebar along the ground, letting it sing off the concrete.', '"This is Breaker ground. You bleed here, you bleed for us."', '"Smash the smart stuff. Keep the dumb stuff. Simple."'] },
  { id: 'npc_breaker_grease', name: 'Grease', sex: 'male', hp: 90, faction: 'faction_breakers', zone: 'zone_meat_slaughter',
    personality: 'lowlife',
    clothing: ['a sleeveless denim cut with the Breakers\' broken-cog patch', 'an oil-slick thermal shirt', 'frayed boxer briefs'],
    desc: "Grease earned the name honestly — he's slick with it head to boot, and it never quite washes off. He guards the Lane's mouth, chewing something that used to be gum, cataloguing everyone who walks in by how much trouble they'll be.",
    chit: ['spits, missing your boot on purpose.', '"Keep walking or start paying. Toll\'s whatever I say it is."'] },
  { id: 'npc_breaker_nyla', name: 'Nyla Sparks', sex: 'female', hp: 90, faction: 'faction_breakers', zone: 'zone_meat_slaughter',
    personality: 'lowlife',
    clothing: ['a fireproof tabard scorched black at every hem', 'a soot-grey tank top', 'a plain sports bra and briefs'],
    desc: "Nyla keeps a row of bottles racked on her hip, each stoppered with an oily rag, and the easy smile of someone who genuinely enjoys her work. The Breakers point her at anything with a screen and let her cook.",
    chit: ['thumbs a lighter open and shut, open and shut.', '"Everything burns. Circuit boards just burn prettier."'] },

  // ── THE CUSTODIANS ─ corporate cult, Architect-reverent, Old Coldwater ruins ──
  { id: 'npc_custodian_ferrin', name: 'Deacon Aldous Ferrin', sex: 'male', hp: 120, faction: 'faction_custodians', zone: 'zone_ruins',
    personality: 'corporate',
    clothing: ['a hi-vis vestment worn over a charcoal three-piece suit', 'a starched white shirt with a fraying collar', 'pressed grey briefs'],
    desc: "Deacon Ferrin tends the ruins of Old Coldwater the way a verger tends a cathedral — reverently, and with a clipboard. He believes the Architect maintains all things and that the Custodians are simply its middle management. He will explain this to you at length, whether or not you asked.",
    chit: ['runs a white glove along a broken rail and studies the dust with quiet disappointment.', '"The Architect maintains. We merely file the paperwork."', '"This district is under Custodial care. Kindly do not deface the ruins."'] },
  { id: 'npc_custodian_wren', name: 'Custodian-Adjunct Wren', sex: 'female', hp: 90, faction: 'faction_custodians', zone: 'zone_ruins',
    personality: 'official',
    clothing: ['a laminated tabard hung with cleaning-rota clipboards', 'a grey pencil-skirt suit', 'a beige bra and briefs'],
    desc: "Adjunct Wren has a form for everything and a pen that never runs dry. She logs each visitor to the ruins in triplicate and issues citations for infractions no one else can see. Cross her and the paperwork becomes eternal.",
    chit: ['notes your arrival on a clipboard without looking up.', '"You are not on the approved-access list. I\'ll require a reason. In writing."'] },
  { id: 'npc_custodian_pell', name: 'Sub-Custodian Pell', sex: 'male', hp: 90, faction: 'faction_custodians', zone: 'zone_ruins',
    personality: 'clerk',
    clothing: ['a grey maintenance cassock with a name stitched over the breast', 'a company polo shirt buttoned to the throat', 'white cotton briefs'],
    desc: "Pell mops. That is the whole of Pell's visible ministry — a slow, devotional mopping of floors that crumbled to gravel years ago. He hums the Coldwater hum under his breath and flinches if you interrupt the rhythm.",
    chit: ['moves his mop over bare rubble in careful, reverent strokes.', '"Mustn\'t let it get untidy. The Architect notices untidy things."'] },

  // ── THE GLITCH ─ hacker mystics, rogue-AI worship, The Under ──
  { id: 'npc_glitch_oracle', name: 'Oracle-9', sex: 'female', hp: 110, faction: 'faction_glitch', zone: 'zone_tunnels',
    personality: 'lowlife',
    clothing: ['a cloak stitched from dead server-blade shielding', 'a hoodie sagging with looped patch cable', 'a mismatched bralette and briefs'],
    desc: "Oracle-9 sits in the dark of The Under with her eyes half-closed and a fan of severed fibre-optic running into a socket at the base of her skull. The Glitch treat her word as scripture; she treats packet loss as prophecy. She may be brilliant. She is definitely not well.",
    chit: ['tilts her head as if listening to a frequency you can\'t hear.', '"The Architect speaks in dropped packets. We are learning to answer."', '"You\'re standing in the Glitch\'s signal, meat. Mind the interference."'] },
  { id: 'npc_glitch_null', name: 'Null', sex: 'male', hp: 90, faction: 'faction_glitch', zone: 'zone_tunnels',
    personality: 'lowlife',
    clothing: ['a taped-together longcoat bristling with dead antennas', 'a black tee showing a corrupted logo', 'grey trunks'],
    desc: "Null talks in the cadence of a dial-up handshake and answers questions you didn't ask. He runs the Under's makeshift relays and guards them like a dog guards a bone it can no longer taste.",
    chit: ['twitches through a keystroke pattern with restless fingers.', '"Access denied. You are not — hkkt — one of us yet."'] },
  { id: 'npc_glitch_hex', name: 'Hex', sex: 'female', hp: 90, faction: 'faction_glitch', zone: 'zone_tunnels',
    personality: 'lowlife',
    clothing: ['a hooded poncho of woven ribbon-cable', 'a cropped mesh top over circuit-inked skin', 'a black bra and boyshorts'],
    desc: "Hex smiles too much and blinks too little, her skin traced with conductive ink that catches the tunnel-light like faint circuitry. She collects other people's passwords the way children collect shiny stones, for no reason she can explain.",
    chit: ['watches you with her head cocked, grinning at something only she can see.', '"Ooh. You\'ve got such a pretty little password behind those eyes."'] },
];

async function seed() {
  let npcCount = 0;
  for (const n of NPCS) {
    const flags = { personality: n.personality, faction_guard: true, clothing_layers: n.clothing };
    const res = await query(
      `INSERT INTO npcs (id, name, description, zone_id, home_zone, faction, sex, npc_type, wanders,
                         flags, chitchat, dialogue_tree, vendor_inventory, behaviour_graph, banter, hp, hp_max)
       VALUES ($1,$2,$3,$4,$4,$5,$6,'npc',0,$7,$8,'{}','[]','{}','[]',$9,$9)
       ON CONFLICT (id) DO NOTHING`,
      [n.id, n.name, n.desc, n.zone, n.faction, n.sex, JSON.stringify(flags), JSON.stringify(n.chit), n.hp]);
    npcCount += res.rowCount;
  }
  console.log(`✓ Seeded ${npcCount}/${NPCS.length} faction NPC(s).`);
  console.log('  Restart the server (or reload the world) to load them into the live caches.');
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
