// One-shot content: "The Choirmaster" — a VINE showcase boss.
//   Run once:  node scripts/add-demo-boss.js
//   Then:      spawn it into a zone (dev panel → Enemies → Spawn, or admin .spawn
//              enemy_choirmaster_demo) and restart / hit /world/reload so the
//              enemy template + graph are cached.
//
// This exists to SHOW OFF what a hand-authored behaviour_graph can do — not to be
// permanent content. Everything below is built from real, supported VINE nodes
// (see docs/ai-behaviour.md). Idempotent: ON CONFLICT DO UPDATE re-applies the
// latest graph, so tweak-and-rerun works.
//
// What makes this a *behaviour tree* and not a stateless "attack" loop:
//   • Three HP phases (Sermon → Wrath → Rapture), each with its own tempo/lines.
//   • Per-instance MEMORY (self-scope flags) so every phase-transition beat fires
//     EXACTLY ONCE — the greeting, the enrage roar, the death-bargain. A stateless
//     graph would spam them every tick; the flag gate is what buys real theatre.
//   • Weighted RANDOM barks so it never reads the same twice.
//   • On enrage it CALLS BACKUP and RE-TARGETS the lowest-HP player (picks off the
//     wounded).
//   • At <33% it BEGS, then FLEES once — you have to hunt it down — and on the
//     re-engage the 'rapture' flag routes it straight to a fights-to-the-death
//     last stand instead of fleeing again.
import { query } from '../server/models/db.js';

const ID = 'enemy_choirmaster_demo';

// ── The behaviour graph ─────────────────────────────────────────────────────────
// Built-in DB format: node.next / .ifTrue / .ifFalse / .branch_N are the edges;
// the runtime normalizes them. Execution stops at the first ACTION each tick, so
// scripted "sequences" (SET_FLAG → SAY → CALL_BACKUP …) play out one beat/second.
const GRAPH = {
  _start: 'root',
  nodes: {
    root:       { type: 'start', next: 'has_target' },

    // Combat or idle?
    has_target: { type: 'condition', condition_type: 'HAS_TARGET',
                  ifTrue: 'gate_low', ifFalse: 'idle_branch' },

    // ── Out of combat: hum a hymn now and then, otherwise stand and wait ──
    idle_branch:{ type: 'condition', condition_type: 'RANDOM_CHANCE', params: { chance: 0.2 },
                  ifTrue: 'idle_say', ifFalse: 'idle_act' },
    idle_say:   { type: 'action', action_type: 'SAY',
                  params: { message: 'hums a hymn under its breath, off-key and endless.', cooldown_s: 20 },
                  next: 'idle_act' },
    idle_act:   { type: 'action', action_type: 'IDLE', next: 'loop' },

    // ── Phase gates: check the WORST case first (lowest HP wins) ──
    gate_low:   { type: 'condition', condition_type: 'HP_BELOW', params: { pct: 33 },
                  ifTrue: 'p3_enter', ifFalse: 'gate_mid' },
    gate_mid:   { type: 'condition', condition_type: 'HP_BELOW', params: { pct: 66 },
                  ifTrue: 'p2_enter', ifFalse: 'p1_enter' },

    // ── PHASE 1 — The Sermon (>66% HP): measured, preachy, slow ──
    p1_enter:   { type: 'condition', condition_type: 'FLAG_SET', params: { scope: 'self', flag: 'sermon' },
                  ifTrue: 'p1_choose', ifFalse: 'p1_mark' },
    p1_mark:    { type: 'action', action_type: 'SET_FLAG', params: { scope: 'self', flag: 'sermon', value: '1' },
                  next: 'p1_greet' },
    p1_greet:   { type: 'action', action_type: 'SAY',
                  params: { message: 'Kneel, or be knelt. Makes no difference to me.', cooldown_s: 0 },
                  next: 'p1_choose' },
    p1_choose:  { type: 'random', branches: [{ weight: 4 }, { weight: 1 }],
                  branch_0: 'p1_attack', branch_1: 'p1_taunt' },
    p1_taunt:   { type: 'action', action_type: 'SAY',
                  params: { message: 'Hold still. Grace is easier to administer that way.', cooldown_s: 12 },
                  next: 'p1_attack' },
    p1_attack:  { type: 'action', action_type: 'ATTACK', next: 'loop' },

    // ── PHASE 2 — The Wrath (33–66% HP): enrages ONCE, rallies, hunts the weak ──
    p2_enter:   { type: 'condition', condition_type: 'FLAG_SET', params: { scope: 'self', flag: 'wrath' },
                  ifTrue: 'p2_choose', ifFalse: 'p2_mark' },
    p2_mark:    { type: 'action', action_type: 'SET_FLAG', params: { scope: 'self', flag: 'wrath', value: '1' },
                  next: 'p2_roar' },
    p2_roar:    { type: 'action', action_type: 'SAY',
                  params: { message: "YOU'VE INTERRUPTED THE SERMON. THE CHOIR OBJECTS.", cooldown_s: 0 },
                  next: 'p2_summon' },
    p2_summon:  { type: 'action', action_type: 'CALL_BACKUP', params: { radius: 3, faction_only: false },
                  next: 'p2_retarget' },
    p2_retarget:{ type: 'action', action_type: 'ACQUIRE_TARGET', params: { prefer: 'lowest_hp' },
                  next: 'p2_choose' },
    p2_choose:  { type: 'random', branches: [{ weight: 3 }, { weight: 1 }, { weight: 1 }],
                  branch_0: 'p2_attack', branch_1: 'p2_taunt_a', branch_2: 'p2_taunt_b' },
    p2_taunt_a: { type: 'action', action_type: 'SAY',
                  params: { message: 'The weakest voice always breaks first. Sing for me.', cooldown_s: 8 },
                  next: 'p2_attack' },
    p2_taunt_b: { type: 'action', action_type: 'SAY',
                  params: { message: 'You bleed on consecrated ground. Unforgivable.', cooldown_s: 8 },
                  next: 'p2_attack' },
    p2_attack:  { type: 'action', action_type: 'ATTACK', next: 'loop' },

    // ── PHASE 3 — The Rapture (<33% HP): begs, FLEES once, then last stand ──
    p3_enter:   { type: 'condition', condition_type: 'FLAG_SET', params: { scope: 'self', flag: 'rapture' },
                  ifTrue: 'p3_choose', ifFalse: 'p3_mark' },
    p3_mark:    { type: 'action', action_type: 'SET_FLAG', params: { scope: 'self', flag: 'rapture', value: '1' },
                  next: 'p3_beg' },
    p3_beg:     { type: 'action', action_type: 'SAY',
                  params: { message: 'The choir will remember your name. Briefly.', cooldown_s: 0 },
                  next: 'p3_flee' },
    p3_flee:    { type: 'action', action_type: 'FLEE', next: 'loop' },
    p3_choose:  { type: 'random', branches: [{ weight: 2 }, { weight: 1 }],
                  branch_0: 'p3_attack', branch_1: 'p3_rattle' },
    p3_rattle:  { type: 'action', action_type: 'SAY',
                  params: { message: 'Even now... I can hear them tuning up for you.', cooldown_s: 6 },
                  next: 'p3_attack' },
    p3_attack:  { type: 'action', action_type: 'ATTACK', next: 'loop' },

    // Cycle: re-evaluate every tick so HP crossings switch phases the moment they happen.
    loop:       { type: 'loop', next: 'root' },
  },
};

// ── The enemy ────────────────────────────────────────────────────────────────────
const BOSS = {
  id: ID,
  name: 'The Choirmaster',
  description: 'A tall, robed thing wound in frayed speaker-wire, its face a cluster of dead speaker cones that twitch toward any sound. It conducts an orchestra only it can hear.',
  hp_max: 140,                       // roomy enough that all three phases are felt
  hit: 4,
  dodge: 3,
  weapon: [{ min: 4, max: 9, type: 'kinetic' }],
  body_parts: [
    { part: 'head',  soak: {}, weight: 20 },
    { part: 'torso', soak: {}, weight: 55 },
    { part: 'arms',  soak: {}, weight: 25 },
  ],
  loot_table: [{ item: 'item_scrap', qty: [2, 5], weight: 100 }],
  butcher_table: [],
  butcher_difficulty: 6,
  behavior: 'aggressive',            // REQUIRED: auto-acquires a target so HAS_TARGET fires
  faction: 'choir',
  death_message: 'The Choirmaster crumples, speaker-cones going silent one by one. The hymn finally stops.',
  flags: {
    battle_cries: [
      '$enemy tilts its cone-cluster toward $player, listening.',
      "$enemy's wires twitch in time to a rhythm only it can hear.",
    ],
  },
  behaviour_graph: GRAPH,
};

await query(
  `INSERT INTO enemies (id,name,description,hit,dodge,hp_max,weapon,body_parts,loot_table,butcher_table,butcher_difficulty,behavior,faction,death_message,flags,behaviour_graph)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
   ON CONFLICT (id) DO UPDATE SET
     name=EXCLUDED.name, description=EXCLUDED.description, hit=EXCLUDED.hit, dodge=EXCLUDED.dodge,
     hp_max=EXCLUDED.hp_max, weapon=EXCLUDED.weapon, body_parts=EXCLUDED.body_parts,
     loot_table=EXCLUDED.loot_table, butcher_table=EXCLUDED.butcher_table,
     butcher_difficulty=EXCLUDED.butcher_difficulty, behavior=EXCLUDED.behavior,
     faction=EXCLUDED.faction, death_message=EXCLUDED.death_message, flags=EXCLUDED.flags,
     behaviour_graph=EXCLUDED.behaviour_graph`,
  [BOSS.id, BOSS.name, BOSS.description, BOSS.hit, BOSS.dodge, BOSS.hp_max,
   JSON.stringify(BOSS.weapon), JSON.stringify(BOSS.body_parts), JSON.stringify(BOSS.loot_table),
   JSON.stringify(BOSS.butcher_table), BOSS.butcher_difficulty, BOSS.behavior, BOSS.faction,
   BOSS.death_message, JSON.stringify(BOSS.flags), JSON.stringify(BOSS.behaviour_graph)]
);

console.log(`OK  upserted ${BOSS.id} (${Object.keys(GRAPH.nodes).length}-node behaviour graph)`);
process.exit(0);
