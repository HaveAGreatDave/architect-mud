// One-shot generator: the Ascendant Stronghold — a chrome campus in the grassland
// band just inside the Architect's Curtain, west of Halcyon Towers (see
// docs/proposals/ascendant-stronghold.md). Edits content/zones/*.json directly
// (git is the source of truth), using the pipeline's canonicalJson so the diff is
// clean and re-running produces the same bytes.
//
//   node scripts/build-ascendant-stronghold.mjs          # dry-run: print the plan
//   node scripts/build-ascendant-stronghold.mjs --write   # rewrite the JSON files
//
// It (a) repurposes six grass tiles (892-893 × 905-907) into building facades,
// (b) creates their interiors, and (c) removes the reciprocal exits on the five
// bordering grass/boulevard tiles so The Ascension Gate (893,906) is the sole
// ingress from the Halcyon side. The col-891 (Curtain/Slagworks) west exits are
// left intact on purpose — a hostile frontier back door, gated later.
//
// building_type asc_* keys drive the bespoke 3D models added in windshield.js;
// until those land the renderer falls back to a biome archetype (still 3D).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const ZONES = join(CONTENT_DIR, 'zones');
const NOW = '1783740000'; // fixed, deterministic (Date.now is unavailable/undesired here)

const CHROME_BG = '#161a22';
const CHROME_FG = '#dbe7ff';

const path = (id) => join(ZONES, `${id}.json`);
const read = (id) => JSON.parse(readFileSync(path(id), 'utf8'));

const plan = []; // { id, action, obj|mutate }

function base(o) {
  return {
    ambient_events: [],
    ambient_theme: o.ambient_theme ?? 'indoors',
    audio_theme_id: null,
    bg_color: o.bg_color ?? CHROME_BG,
    color: o.color ?? CHROME_FG,
    created_by: 'ascendant-stronghold',
    description: o.description,
    exits: o.exits,
    flags: o.flags,
    grid_x: o.grid_x ?? 0,
    grid_y: o.grid_y ?? 0,
    grid_z: o.grid_z ?? 0,
    id: o.id,
    map_id: o.map_id,
    marker: o.marker ?? null,
    name: o.name,
    parent_zone: o.parent_zone ?? null,
    updated_at: NOW,
  };
}

// ── Facade (repurpose an existing grass grid tile) ──────────────────────────
function facade({ id, gx, gy, bt, name, marker, floors, world_exit, exits, description, extraFlags = {} }) {
  const z = base({
    id, grid_x: gx, grid_y: gy, map_id: 'map_world', marker, name,
    ambient_theme: 'city', description, exits,
    flags: {
      ascendant_campus: true,
      building_name: name,
      building_type: bt,
      district: 'wasteland',
      facade: true,
      floors,
      is_building: true,
      world_exit_zone: world_exit,
      ...extraFlags,
    },
  });
  plan.push({ id, action: 'repurpose', obj: z });
}

// ── Interior room ───────────────────────────────────────────────────────────
function room({ id, mapId, facadeId, name, exits, description, extraFlags = {} }) {
  const z = base({
    id, map_id: mapId, parent_zone: facadeId, name, description, exits,
    flags: { is_building: true, is_interior: true, world_exit_zone: facadeId, ...extraFlags },
  });
  plan.push({ id, action: 'create', obj: z });
}

// ── Drop a reciprocal exit on a bordering tile (seal the campus edge) ────────
function dropExit(id, dir, expectTarget) {
  plan.push({ id, action: 'trim', dir, expectTarget });
}

/* ════════════════════════════════ FACADES ════════════════════════════════ */

// 1. The Ascension Gate — sole ingress from the boulevard (893,906 fronts E).
facade({
  id: 'zone_district_893_906', gx: 893, gy: 906, bt: 'asc_gate',
  name: 'The Ascension Gate', marker: 'AG', floors: 4, world_exit: 'zone_district_894_906',
  description: "The grass stops dead at a line of mirror-polished plaza, and on it stands the Gate: a slab of seamless chrome flanked by two augmented wardens who do not shift their weight and two turret housings that track you without pretending not to. A scanline of pale light sweeps you head to foot. Nothing here is hidden — that is the point. The unwired are simply, politely, not admitted.",
  exits: {
    east: 'zone_district_894_906',
    west: 'zone_district_892_906',
    north: 'zone_district_893_905',
    south: 'zone_district_893_907',
    in: 'zone_asc_gate_post',
  },
  extraFlags: { ascension_gate: true },
});

// 2. The Spire — centerpiece / plaza hub (892,906 fronts E toward the Gate).
facade({
  id: 'zone_district_892_906', gx: 892, gy: 906, bt: 'asc_spire',
  name: 'The Spire', marker: 'AS', floors: 30, world_exit: 'zone_district_893_906',
  description: "The Spire twists up out of the plaza in a slow chrome helix, each floor rotated a few degrees off the last so the whole tower seems mid-turn, caught ascending. Its glass throws back a cold blue sky that isn't quite the one overhead. At its foot a ten-metre seal is inlaid in the ground: a calm eye above a city skyline. You have seen that eye before, somewhere, and the memory won't quite surface.",
  exits: {
    east: 'zone_district_893_906',
    north: 'zone_district_892_905',
    south: 'zone_district_892_907',
    west: 'zone_district_891_906',
    in: 'zone_asc_spire_concourse',
  },
});

// 3. Chrome Clinic (893,905 fronts S toward the Gate).
facade({
  id: 'zone_district_893_905', gx: 893, gy: 905, bt: 'asc_clinic',
  name: 'Chrome Clinic', marker: 'AC', floors: 6, world_exit: 'zone_district_893_906',
  description: "A low, sterile block of frosted glass and brushed steel, lit from within by a light that never flickers. Through the frontage you can make out reclining chairs, articulated arms folded overhead like patient insects, and a price board whose numbers rearrange themselves as you watch — cheaper, the longer the Ascendants have known you.",
  exits: {
    south: 'zone_district_893_906',
    west: 'zone_district_892_905',
    in: 'zone_asc_clinic_consult',
  },
});

// 4. The Weave — fabrication foundry (893,907 fronts N toward the Gate).
facade({
  id: 'zone_district_893_907', gx: 893, gy: 907, bt: 'asc_weave',
  name: 'The Weave', marker: 'AW', floors: 5, world_exit: 'zone_district_893_906',
  description: "A working foundry with its guts on show: robot arms stitch synthetic muscle onto frames behind blast glass, sparks falling in slow orange rain. A sign over the door reads THE WEAVE in letters cut from the same chrome they extrude. It smells of ozone and hot polymer even out here.",
  exits: {
    north: 'zone_district_893_906',
    west: 'zone_district_892_907',
    in: 'zone_asc_weave_line',
  },
});

// 5. The Vats — resurrection registry / save-respawn (892,905 fronts S toward the Spire).
facade({
  id: 'zone_district_892_905', gx: 892, gy: 905, bt: 'asc_vats',
  name: 'The Vats', marker: 'AV', floors: 8, world_exit: 'zone_district_892_906',
  description: "A windowless drum of dull steel, humming with the deep note of coolant pumps. Frost creeps out from its seams. This is where the Ascendants keep their promise that death is only a billing problem — though from the outside it looks less like a promise than a very large, very cold filing cabinet.",
  exits: {
    south: 'zone_district_892_906',
    east: 'zone_district_893_905',
    west: 'zone_district_891_905',
    in: 'zone_asc_vats_registry',
  },
});

// 6. Architect Shrine — the Uplink, pressed against the Curtain (892,907 fronts N;
//    its west face backs onto 891,907, the Curtain edge).
facade({
  id: 'zone_district_892_907', gx: 892, gy: 907, bt: 'asc_shrine',
  name: 'Architect Shrine', marker: 'AR', floors: 10, world_exit: 'zone_district_892_906',
  description: "A cathedral of black glass and cold light stands with its back to the Architect's Curtain — that floor-to-sky sheet of humming hard light — as though leaning against it for warmth. Server racks glow behind the west wall in ranks like votive candles. Of everything out here, this is the only building that faces the Curtain instead of turning away from it.",
  exits: {
    north: 'zone_district_892_906',
    east: 'zone_district_893_907',
    west: 'zone_district_891_907',
    in: 'zone_asc_shrine_nave',
  },
});

/* ════════════════════════════════ INTERIORS ═══════════════════════════════ */

// Gate
room({
  id: 'zone_asc_gate_post', mapId: 'map_int_asc_gate', facadeId: 'zone_district_893_906',
  name: 'The Scanline', exits: { east: 'zone_district_893_906' },
  description: "A narrow guard post behind the Gate's outer slab, all screens and no chairs. A warden construct stands at a lectern of light, reviewing you against a list you are not on. The turrets' feeds play on the wall — the plaza, the boulevard, your own back.",
  extraFlags: { always_lit: true },
});

// Spire
room({
  id: 'zone_asc_spire_concourse', mapId: 'map_int_asc_spire', facadeId: 'zone_district_892_906',
  name: 'Grand Concourse', exits: { east: 'zone_district_892_906', in: 'zone_asc_spire_gallery' },
  description: "The Spire's public floor: a vault of pale stone and colder light, the air filtered to nothing. A curator waits to greet those who make it past the Gate, arms open, certain you have come to be improved. Elevators of brushed steel wait along one wall; the call panel glows with floors that go very high.",
  extraFlags: { always_lit: true },
});
room({
  id: 'zone_asc_spire_gallery', mapId: 'map_int_asc_spire', facadeId: 'zone_district_892_906',
  name: 'Gallery of Rungs', exits: { down: 'zone_asc_spire_concourse', up: 'zone_asc_spire_sanctum' },
  description: "A long hall of lit vitrines, each holding one rung of the ladder: a first crude jack; a coil of subdermal weave; a cortical backup drive on black velvet, labelled THE ONLY THING WORTH KEEPING. The exhibit is arranged so you walk it from meat to something else, and by the end you are meant to want it.",
  extraFlags: { always_lit: true },
});
room({
  id: 'zone_asc_spire_sanctum', mapId: 'map_int_asc_spire', facadeId: 'zone_district_892_906',
  name: 'Executive Sanctum', exits: { down: 'zone_asc_spire_gallery' },
  description: "The crown of the Spire, and the answer to that half-memory at the door: the seal is here too, ten metres wide — the calm eye over the city skyline — but rendered now in living chrome, and it is the Ascendant sigil, and it is also, unmistakably, the Halcyon seal. The same eye. It was always watching. Something barely flesh presides here, and it has been expecting you.",
  extraFlags: { always_lit: true, ascendant_inner: true },
});

// Clinic — augment_clinic makes `augment install/remove` work here.
room({
  id: 'zone_asc_clinic_consult', mapId: 'map_int_asc_clinic', facadeId: 'zone_district_893_905',
  name: 'Consultation', exits: { south: 'zone_district_893_905', in: 'zone_asc_clinic_theatre' },
  description: "A calm room the colour of a fresh bandage. A chrome-doctor reviews your body the way a mechanic reviews a trade-in — not unkindly, just already pricing the parts. A catalogue of augments scrolls on the wall, each with a number that softens as your standing with the Ascendants rises.",
  extraFlags: { always_lit: true, augment_clinic: true },
});
room({
  id: 'zone_asc_clinic_theatre', mapId: 'map_int_asc_clinic', facadeId: 'zone_district_893_905',
  name: 'The Theatre', exits: { out: 'zone_asc_clinic_consult' },
  description: "The install theatre: a single reclining chair under a corolla of folded arms, everything mirrored so you can watch what they do. This is where the first chrome goes in — and where, they tell you gently, the flesh-rot of any mutation gets scraped out first, because chrome does not share a body with the old evolution.",
  extraFlags: { always_lit: true, augment_clinic: true },
});

// Weave
room({
  id: 'zone_asc_weave_line', mapId: 'map_int_asc_weave', facadeId: 'zone_district_893_907',
  name: 'The Line', exits: { north: 'zone_district_893_907', in: 'zone_asc_weave_cage' },
  description: "The fabrication floor, loud with the patient violence of machines that build bodies. A foreman — more chrome than not — walks the line, and will sell you components off it if he reckons you can be trusted with what they become.",
  extraFlags: { always_lit: true },
});
room({
  id: 'zone_asc_weave_cage', mapId: 'map_int_asc_weave', facadeId: 'zone_district_893_907',
  name: 'Stock Cage', exits: { out: 'zone_asc_weave_line' },
  description: "A caged mezzanine of shelved stock: blank frames, spooled weave, ocular blanks staring in rows. Everything is tagged, counted, and worth more than you.",
  extraFlags: { always_lit: true },
});

// Vats — the save point + backup respawn target (wired in a later phase).
room({
  id: 'zone_asc_vats_registry', mapId: 'map_int_asc_vats', facadeId: 'zone_district_892_905',
  name: 'The Registry', exits: { south: 'zone_district_892_905', in: 'zone_asc_vats_hall' },
  description: "A cold clerical antechamber where a soft-voiced construct confirms the balance of your policy. It speaks of your death the way a teller speaks of an overdraft: a solvable inconvenience, provided your account is paid up.",
  extraFlags: { always_lit: true, ascendant_registry: true },
});
room({
  id: 'zone_asc_vats_hall', mapId: 'map_int_asc_vats', facadeId: 'zone_district_892_905',
  name: 'The Vat Hall', exits: { out: 'zone_asc_vats_registry' },
  description: "Rows of tall tanks recede into cold fog, each holding a shape that might be sleeping. This is where the backed-up wake up — where death, for those paid in full, is just a bad night's sleep in an expensive bed.",
  extraFlags: { always_lit: true, ascendant_vats: true },
});

// Architect Shrine
room({
  id: 'zone_asc_shrine_nave', mapId: 'map_int_asc_shrine', facadeId: 'zone_district_892_907',
  name: 'The Nave', exits: { north: 'zone_district_892_907', in: 'zone_asc_shrine_uplink' },
  description: "A nave of humming server-racks under cold light, the Curtain a wall of white fire beyond the west glass. A celebrant tends the machines the way a priest tends an altar — because to him there is no difference. He is, as far as anyone can tell, the only person in the Basin who loves the Architect.",
  extraFlags: { always_lit: true },
});
room({
  id: 'zone_asc_shrine_uplink', mapId: 'map_int_asc_shrine', facadeId: 'zone_district_892_907',
  name: 'The Uplink', exits: { out: 'zone_asc_shrine_nave' },
  description: "A single terminal set into the Curtain itself, where hard light meets cold glass. Here, they say, you can speak to the Architect — or to the part of yourself the Ascendants intend to upload into it. The hum is very loud, and very patient.",
  extraFlags: { always_lit: true, architect_uplink: true },
});

/* ══════════════════════ SEAL THE CAMPUS EDGES (reciprocal trims) ═══════════ */
// Everything east/north/south of the campus loses its exit into it, so the only
// Halcyon-side way in is through The Ascension Gate. (891/Curtain side kept open.)
dropExit('zone_district_893_904', 'south', 'zone_district_893_905'); // N of Clinic
dropExit('zone_district_894_905', 'west',  'zone_district_893_905'); // E of Clinic
dropExit('zone_district_894_907', 'west',  'zone_district_893_907'); // E of Weave
dropExit('zone_district_892_904', 'south', 'zone_district_892_905'); // N of Vats
dropExit('zone_district_892_908', 'north', 'zone_district_892_907'); // S of Shrine

/* ════════════════════════════════ APPLY ═══════════════════════════════════ */
let created = 0, repurposed = 0, trimmed = 0, skipped = 0;
for (const step of plan) {
  if (step.action === 'trim') {
    if (!existsSync(path(step.id))) { console.warn(`  ⚠ trim: ${step.id} missing, skip`); skipped++; continue; }
    const z = read(step.id);
    const cur = z.exits?.[step.dir];
    if (cur === undefined) { console.log(`  · ${step.id}: no ${step.dir} exit (already trimmed)`); continue; }
    if (cur !== step.expectTarget) { console.warn(`  ⚠ ${step.id}.${step.dir} = ${cur}, expected ${step.expectTarget} — leaving as-is`); skipped++; continue; }
    delete z.exits[step.dir];
    if (WRITE) writeFileSync(path(step.id), canonicalJson(z));
    console.log(`  ✂ ${step.id}: drop ${step.dir} → ${step.expectTarget}`);
    trimmed++;
    continue;
  }
  const exists = existsSync(path(step.id));
  if (WRITE) writeFileSync(path(step.id), canonicalJson(step.obj));
  if (step.action === 'repurpose') { console.log(`  ⌂ ${step.id}: → ${step.obj.name} (${step.obj.flags.building_type})`); repurposed++; }
  else { console.log(`  + ${step.id}: ${step.obj.name}${exists ? ' (overwrite)' : ''}`); created++; }
}

console.log(`\n${WRITE ? 'WROTE' : 'DRY-RUN'} — ${repurposed} facades, ${created} interiors, ${trimmed} edge trims, ${skipped} skipped.`);
if (!WRITE) console.log('Re-run with --write to apply.');
