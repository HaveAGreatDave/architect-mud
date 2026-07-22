// populate-yards-tenement.mjs — fill the 60 units of The Yards Tenement with NPC
// residents at 2 per unit, rarely 3 (per the housing-density rule). File-authoring:
// emits ~129 NPC content files + one npc_residences row per unit (the "primary"
// resident marks the unit occupied so players can't rent it — it's NPC housing).
// Deterministic (seeded by index) → idempotent. Run: node scripts/populate-yards-tenement.mjs
//
// Roommates cohabit via a shared home_zone (no uniqueness constraint), which is how the
// 2-3/unit density works without a residence-model change. Clothing + npc_type come from
// the engine's own npc-personality tables so these read like every other NPC.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickClothingForPersonality, npcTypeForPersonality } from '../server/engine/npc-personality.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '1783971000';
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys)
  : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])) : x;
const write = (rel, o) => writeFileSync(join(ROOT, rel), JSON.stringify(sortKeys(o), null, 2) + '\n');
const pick = (arr, seed) => arr[((seed % arr.length) + arr.length) % arr.length];

const FLOORS = 10, PER_FLOOR = 6;
const EMPTY_SCHED = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

// weighted toward the down-and-out; every entry is a real npc-personality slug (has clothing)
const PERSONA = [
  'unemployed', 'unemployed', 'unemployed', 'unemployed', 'vagrant', 'vagrant', 'vagrant',
  'thug', 'thug', 'dealer', 'mercenary', 'bartender', 'preacher', 'scientist', 'cult_member',
];
const HP = { thug: 34, mercenary: 34, dealer: 26, guard: 30 };   // default 20 otherwise

const FIRST_M = ['Denny', 'Reggie', 'Vic', 'Marlon', 'Sal', 'Ossie', 'Kurt', 'Len', 'Bram', 'Cole', 'Ivo', 'Hollis', 'Reef', 'Pell', 'Dax', 'Rune', 'Gus', 'Merle', 'Tobin', 'Cass', 'Bo', 'Jory', 'Fenn', 'Wade', 'Sten', 'Ike', 'Roan', 'Dell', 'Griff', 'Mose'];
const FIRST_F = ['Marla', 'Dot', 'Vera', 'Sela', 'Nan', 'Ruby', 'Ines', 'Wren', 'Cleo', 'Tam', 'Bess', 'Odell', 'Juno', 'Pia', 'Fay', 'Lark', 'Sig', 'Nell', 'Rilla', 'Cass', 'Mabel', 'Vesta', 'Etta', 'Dane', 'Sook', 'Nadia', 'Bree', 'Lottie', 'Maud', 'Sable'];
const SUR = ['Holt', 'Crane', 'Vane', 'Sable', 'Nix', 'Ruck', 'Dolan', 'Merrit', 'Skell', 'Pryce', 'Voss', 'Kade', 'Larkin', 'Trask', 'Ossory', 'Quill', 'Renn', 'Fisk', 'Grady', 'Marsh', 'Coyle', 'Dupre', 'Yarrow', 'Brandt', 'Selk', 'Orme', 'Vachs', 'Deel', 'Pike', 'Roon', 'Crost', 'Ainsley', 'Mott', 'Serle', 'Trant', 'Volk', 'Dray', 'Kessel', 'Nunn', 'Ostry', 'Prewitt', 'Sarn', 'Teller', 'Ung', 'Weir', 'Yale', 'Zell', 'Brack', 'Cull', 'Dench'];

// one description per persona; a deterministic quirk is appended so no two read alike
const DESC = {
  unemployed: (n) => `${n} is one of the Tenement's long-term unemployed — thin, watchful, and permanently between things. The dole card is maxed and the days are all the same shape.`,
  vagrant: (n) => `${n} drifted in off the freight lanes and never quite drifted back out. Officially nobody's here; unofficially, this is home now.`,
  thug: (n) => `${n} is muscle for hire when there's hire to be had, and a problem when there isn't. The knuckles have stories the mouth won't tell.`,
  dealer: (n) => `${n} runs a quiet little trade out of the stairwell — nothing you'd notice unless you were looking to buy. Very polite about it.`,
  mercenary: (n) => `${n} did contract work somewhere loud and came home wrong. Keeps the door double-locked and the light off.`,
  bartender: (n) => `${n} pulled pints somewhere with a better postcode until the somewhere closed. Still wipes down surfaces out of habit.`,
  preacher: (n) => `${n} preaches to the stairwell most evenings, to whoever the acoustics deliver. The message drifts; the volume does not.`,
  scientist: (n) => `${n} had letters after the name once, and a lab, and a future. Now there's a hot plate and a notebook full of increasingly small handwriting.`,
  cult_member: (n) => `${n} belongs to something the rest of the building doesn't ask about, and leaves little chalk marks by the door that nobody scrubs off.`,
};
const QUIRK = [
  'Coughs like the building does — in the pipes, at night.',
  'Nods at everyone and remembers no one.',
  'Keeps a chair wedged under the door handle.',
  'Feeds a cat that may or may not exist.',
  'Argues with the radio.',
  'Waters a dead plant on the sill with great faith.',
  'Counts the floors on the way up, every time, out loud.',
  'Owes rent and everyone knows it.',
  'Never takes off the coat.',
  'Sleeps through the day, awake all night.',
  'Collects the mail that isn\'t theirs and never opens it.',
  'Hums something nobody can place.',
];

let idx = 0, npcCount = 0, resCount = 0, thirds = 0;
for (let f = 1; f <= FLOORS; f++) {
  for (let u = 1; u <= PER_FLOOR; u++) {
    const unitZone = `zone_yards_tenement_u${f}_${u}`;
    const unitNo = `${f}${String(u).padStart(2, '0')}`;
    const unitIdx = (f - 1) * PER_FLOOR + (u - 1);
    const count = (unitIdx % 7 === 2) ? 3 : 2;           // rarely a 3rd
    if (count === 3) thirds++;
    for (let n = 0; n < count; n++, idx++) {
      const sex = (idx % 2 === 0) ? 'male' : 'female';
      const first = pick(sex === 'male' ? FIRST_M : FIRST_F, idx * 7 + 3);
      const last = pick(SUR, idx * 13 + 5);
      const name = `${first} ${last}`;
      const persona = pick(PERSONA, idx * 11 + f + u);
      const clothing = pickClothingForPersonality(persona, sex) || [];
      const hp = HP[persona] || 20;
      const desc = `${DESC[persona](name)} ${pick(QUIRK, idx * 5 + 1)}`;
      const id = `npc_tenement_${f}_${u}_${n + 1}`;
      write(`content/npcs/${id}.json`, {
        id, name, description: desc, sex, npc_type: npcTypeForPersonality(persona) || 'npc',
        home_zone: unitZone, hp, hp_max: hp, faction: null,
        flags: { personality: persona, clothing_layers: clothing },
        behaviour_graph: {}, dialogue_tree: {}, chitchat: [], banter: [], home_activities: [],
        wanders: 0, wander_zones: [], work_zone_id: null, studio_zone_id: null,
        vendor_inventory: [], vendor_schedule: EMPTY_SCHED, vendor_shop_name: null,
        vendor_stock_size: 10, vendor_restock_rate: 1,
      });
      npcCount++;
      if (n === 0) {   // primary resident marks the unit occupied (NPC housing, unrentable)
        write(`content/npc_residences/${unitZone}.json`, { npc_id: id, zone_id: unitZone });
        resCount++;
      }
    }
  }
}

console.log(`✓ The Yards Tenement populated.`);
console.log(`  NPCs: ${npcCount} across ${FLOORS * PER_FLOOR} units (${thirds} units got a 3rd; rest have 2)`);
console.log(`  npc_residences (primary per unit): ${resCount}`);
console.log(`  density: 2/unit, rarely 3 — cohabiting via shared home_zone`);
