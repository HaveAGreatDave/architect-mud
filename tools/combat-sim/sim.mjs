// Combat balance simulator — boots the world headlessly (regress-style: no
// server, no gameLoop) and runs every enemy template against archetype player
// builds, N fights each, reporting win rate / time-to-kill / damage taken.
//
//   npm run combat-sim                  (all enemies, 20 fights per pairing)
//   node tools/combat-sim/sim.mjs --fights 50 --enemy enemy_rat
//
// Pacing: instead of wall-clock waiting, Date.now is patched to a virtual
// clock advanced 1s per loop step — the engine's own cooldown gates
// (attack 3.5s, enemy_attack_interval_ms) then pace the fight exactly as the
// real 1s gameLoop tick would. playerAttackEnemy/enemyAttackPlayer are the
// real math functions; nothing is reimplemented.
//
// Known fidelity limits: archetype skill = stat bonus only (no player_skills
// rows), no status effects/drugs, no darkness penalty, no fleeing.
import { initWorld, world, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, spawnEnemySync, getEnemyInstance } from '../../server/engine/world.js';
import { loadPlugins } from '../../server/engine/plugins.js';
import { loadMisSettings } from '../../server/engine/mis.js';
import { stopAll } from '../../server/engine/scheduler.js';
import { playerAttackEnemy, enemyAttackPlayer } from '../../server/engine/combat.js';
import { query } from '../../server/models/db.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const FIGHTS = +arg('--fights', 20);
const ONLY = arg('--enemy', null);
const MAX_SIM_SECONDS = 600;

const ARCHETYPES = [
  { key: 'fresh', label: 'Fresh spawn', stats: 2, hp: 100,
    weapon: { damage_min: 2, damage_max: 4, weapon_skill: 'fists', damage_type: 'kinetic' }, soak: null },
  { key: 'street', label: 'Street (mid)', stats: 5, hp: 100,
    weapon: { damage_min: 3, damage_max: 8, weapon_skill: 'blades', damage_type: 'kinetic' }, soak: null },
  { key: 'tank', label: 'Tank (armored)', stats: 4, hp: 100, statOverrides: { stat_brawn: 8, stat_endurance: 8 },
    weapon: { damage_min: 4, damage_max: 10, weapon_skill: 'fists', damage_type: 'kinetic' },
    soak: { head: { soak: { kinetic: 3 } }, torso: { soak: { kinetic: 4 }, flat: 1 }, hands: { soak: { kinetic: 2 } }, legs: { soak: { kinetic: 3 } }, feet: { soak: { kinetic: 2 } } } },
  { key: 'glass', label: 'Glass cannon', stats: 3, hp: 100, statOverrides: { stat_reflexes: 8, stat_cool: 8 },
    weapon: { damage_min: 6, damage_max: 14, weapon_skill: 'firearms', damage_type: 'kinetic' }, soak: null },
];

// ---- boot (regress-style; no gameLoop, no server) ----
await initWorld();
await loadMisSettings();
await loadPlugins();

// synthetic arena, invisible to real zones
const ARENA = 'sim_arena_' + process.pid;
world.zones.set(ARENA, { id: ARENA, name: 'Sim Arena', flags: {}, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });

let templates = (await query(`SELECT * FROM enemies ORDER BY id`)).rows;
if (ONLY) templates = templates.filter(t => t.id === ONLY);
const spawnZones = (await query(`
  SELECT zs.enemy_id, z.name FROM zone_spawns zs JOIN zones z ON z.id = zs.zone_id`)).rows;

// virtual clock — patched AFTER boot so init timers are unaffected
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

function makePlayer(arch, i) {
  const p = {
    id: `sim_${arch.key}_${process.pid}_${i}`, handle: `Sim-${arch.label}`, role: 'player',
    current_zone: ARENA, hp: arch.hp, hp_max: arch.hp, stamina: 100, stamina_max: 100,
    sanity: 50, sanity_max: 100, credits: 0, biological_sex: 'male', mob_kills: 0,
    stat_brawn: arch.stats, stat_reflexes: arch.stats, stat_endurance: arch.stats,
    stat_brains: arch.stats, stat_cool: arch.stats, stat_senses: arch.stats,
    ...(arch.statOverrides || {}),
  };
  if (arch.soak) p.soak = arch.soak;
  return p;
}

async function fight(template, arch, i) {
  const enemy = spawnEnemySync(template, ARENA);
  const player = makePlayer(arch, i);
  setLivePlayer(player.id, player);
  addPlayerToZone(player.id, ARENA);
  enemy.targetId = player.id;
  enemy.lastAttack = 0;

  let outcome = 'timeout', ttk = null, swings = 0, hits = 0;
  const t0 = Date.now();
  for (let sec = 0; sec < MAX_SIM_SECONDS; sec++) {
    clockOffset += 1000; // one virtual second per step, like the real 1s tick
    const rp = await playerAttackEnemy(player, enemy.instanceId, arch.weapon);
    if (rp?.success !== false) { swings++; if (rp?.hit) hits++; }
    if (rp?.killed) { outcome = 'win'; ttk = (Date.now() - t0) / 1000; break; }
    const re = await enemyAttackPlayer(enemy, player);
    if (re?.hit) player.hp = Math.max(0, player.hp - re.damage); // gameLoop applies this at :176
    if (player.hp <= 0) { outcome = 'death'; ttk = (Date.now() - t0) / 1000; break; }
  }
  if (getEnemyInstance(enemy.instanceId)) { // clean up survivors (kills self-remove)
    world.enemies.delete(enemy.instanceId);
    world.zones.get(ARENA)?.enemies?.delete(enemy.instanceId);
  }
  removePlayerFromZone(player.id, ARENA);
  removeLivePlayer(player.id);
  return { outcome, ttk, hpLeft: player.hp, accuracy: swings ? hits / swings : 0 };
}

const results = [];
for (const t of templates) {
  const row = { enemy: t.id, name: t.name, hp: t.hp_max, hit: t.hit, dodge: t.dodge,
    zones: [...new Set(spawnZones.filter(s => s.enemy_id === t.id).map(s => s.name))], cells: {} };
  for (const arch of ARCHETYPES) {
    const fights = [];
    for (let i = 0; i < FIGHTS; i++) fights.push(await fight(t, arch, i));
    const wins = fights.filter(f => f.outcome === 'win');
    const deaths = fights.filter(f => f.outcome === 'death');
    row.cells[arch.key] = {
      winRate: wins.length / FIGHTS,
      deathRate: deaths.length / FIGHTS,
      timeouts: fights.length - wins.length - deaths.length,
      avgTtk: wins.length ? wins.reduce((a, f) => a + f.ttk, 0) / wins.length : null,
      avgHpLeft: wins.length ? wins.reduce((a, f) => a + f.hpLeft, 0) / wins.length : null,
      accuracy: fights.reduce((a, f) => a + f.accuracy, 0) / FIGHTS,
    };
    const c = row.cells[arch.key];
    console.log(`${t.id} vs ${arch.key}: win ${(c.winRate * 100).toFixed(0)}% ` +
      (c.avgTtk ? `ttk ${c.avgTtk.toFixed(0)}s hpLeft ${c.avgHpLeft.toFixed(0)}` : '') +
      (c.deathRate ? ` death ${(c.deathRate * 100).toFixed(0)}%` : ''));
  }
  results.push(row);
}

Date.now = realNow;
world.zones.delete(ARENA);

const data = { generatedAt: new Date().toISOString(), fights: FIGHTS,
  archetypes: ARCHETYPES.map(a => ({ key: a.key, label: a.label })), results };
let html = readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html.replace('/*__DATA__*/', JSON.stringify(data));
writeFileSync(path.join(dir, 'combat-sim.html'), html);
console.log(`\n${results.length} enemies × ${ARCHETYPES.length} archetypes × ${FIGHTS} fights`);
console.log(`wrote ${path.join(dir, 'combat-sim.html')}`);

stopAll();
process.exit(0);
