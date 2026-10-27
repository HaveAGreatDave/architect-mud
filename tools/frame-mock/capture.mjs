// Frame mockup, phase 0: capture real payloads from a headless world boot.
//
// Boots the world and plugins the way tests/regress.js does (no server, no
// socket), drives a fake player through three scenes with handleCommand, and
// writes everything that reached the player to payloads.js as
// `window.FRAME_PAYLOADS`. A .js file rather than .json so the mockup opens
// straight from disk.
//
//   node tools/frame-mock/capture.mjs            (local DB; never run against prod)
//
// It writes nothing to the database that it doesn't delete again: the fake
// player's per-player rows are purged on the way out.
import { writeFileSync } from 'fs';
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getLivePlayer, world, moveNpcToZone, spawnEnemySync } from '../../server/engine/world.js';
import { loadItems } from '../../server/engine/items-cache.js';
import { loadDrugs } from '../../server/engine/drugs.js';
import { loadMisSettings } from '../../server/engine/mis.js';
import { loadPlugins } from '../../server/engine/plugins.js';
import { handleCommand } from '../../server/engine/commands/index.js';
import { stopAll } from '../../server/engine/scheduler.js';
import { clearCooldown, enemyAttackPlayer } from '../../server/engine/combat.js';
import { advanceDialogue } from '../../server/engine/dialogue.js';
import pool, { query } from '../../server/models/db.js';

if (/neon|render/.test(process.env.DATABASE_URL || '')) { console.error('capture: refusing to run against a remote DB'); process.exit(1); }

const SCENES = {
  street: { zone: 'zone_district_919_904', cmds: ['look'] },
  bar:    { zone: 'zone_mq_pigeon_bar', npc: 'npc_barkeep', cmds: ['look', 'talk sully', '<choose 2>'] },
  fight:  { zone: 'zone_under_913_909', cmds: ['look', 'attack mutant', '<enemy>', 'attack mutant', '<enemy>', 'attack mutant', '<enemy>'] },
};

let sink = [];
const broadcast = (zoneId, payload, exclude, toPlayer) => { sink.push({ via: 'broadcast', zoneId, toPlayer: toPlayer || null, payload }); };

const quiet = console.log;
console.log = (...a) => { if (!(typeof a[0] === 'string' && /^\s*✓ |Plugin loaded/.test(a[0]))) quiet(...a); };
await initWorld();
await loadItems();
await loadDrugs();
await loadMisSettings();
await loadPlugins();
console.log = quiet;

const P = {
  id: 'frame_capture_' + process.pid,
  handle: 'Wren',
  role: 'player',
  current_zone: SCENES.street.zone,
  hp: 74, hp_max: 100, stamina: 61, stamina_max: 100,
  sanity: 48, sanity_max: 100,
  stat_brawn: 6, stat_reflexes: 6, stat_endurance: 5, stat_brains: 5, stat_cool: 5, stat_senses: 5,
  credits: 140, radiation: 12, hunger: 70, thirst: 55,
  mis_enabled: 0,
  biological_sex: 'female',
  appearance_data: {},
};
setLivePlayer(P.id, P);
addPlayerToZone(P.id, P.current_zone);
const me = () => getLivePlayer(P.id);

function placePlayer(zoneId) {
  removePlayerFromZone(P.id, me().current_zone);
  me().current_zone = zoneId;
  addPlayerToZone(P.id, zoneId);
}

const out = { capturedAt: new Date().toISOString(), player: null, scenes: {} };
for (const [key, scene] of Object.entries(SCENES)) {
  placePlayer(scene.zone);
  if (scene.npc) {
    moveNpcToZone(scene.npc, scene.zone);
    // The capture runs at whatever the game clock says; open the bar for it (RAM only).
    const all = [{ from: 0, to: 24 }];
    world.npcs.get(scene.npc).vendor_schedule = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => [d, all]));
  }
  if (key === 'fight') {
    // A sewer zone's enemies are only there if the spawner put them there; make sure.
    const z = world.zones.get(scene.zone);
    if (!z.enemies?.size) {
      const { rows } = await query(`SELECT * FROM enemies WHERE name ILIKE '%mutant%' LIMIT 1`);
      if (rows[0]) spawnEnemySync(rows[0], scene.zone);
    }
    me().hp = 74;
  }
  const steps = [];
  for (const cmd of scene.cmds) {
    sink = [];
    let result;
    // '<enemy>' is the mob's half of the exchange: one real swing from whatever the
    // player is fighting, which the AI tick would otherwise make.
    try {
      if (cmd === '<enemy>') {
        const foe = world.enemies.get(me().combatTargetId);
        if (foe) foe.lastAttack = 1;   // past its swing interval, but not a first strike
        const r = foe ? await enemyAttackPlayer(foe, me()) : null;
        result = r ? { type: 'combat', from: foe.name, ...r } : { type: 'none' };
      } else if (cmd.startsWith('<choose ')) {
        // A click on a dialogue option. The socket layer tracks the open node, so
        // take the same step it does from the frame captured just before.
        const prev = steps.findLast(s => s.result?.type === 'dialogue')?.result;
        const n = Number(cmd.slice(8, -1));
        const opt = prev.options[n - 1];
        const npc = world.npcs.get(prev.npcId);
        const step = await advanceDialogue({ npc, player: me(), choice: opt.next, optionIndex: n - 1, prevNode: prev.node, context: { broadcast, npc } });
        result = step.type === 'frame'
          ? { type: 'dialogue', npcId: npc.id, npcName: npc.name, node: step.node, text: step.text, options: step.options, stage: step.stage, mood: step.mood, chose: opt.label }
          : { ...step, chose: opt.label };
      } else {
        clearCooldown(P.id, 'attack');
        result = await handleCommand(cmd, me(), broadcast);
      }
    }
    catch (e) { result = { type: 'error', message: String(e?.stack || e) }; }
    steps.push({ cmd, result, broadcasts: sink.filter(b => !b.toPlayer || b.toPlayer === P.id) });
  }
  const z = world.zones.get(scene.zone);
  out.scenes[key] = {
    zone: { id: z.id, name: z.name, grid_x: z.grid_x, grid_y: z.grid_y, map_id: z.map_id, terrain: z.flags?.terrain || null, building_type: z.building_type || null },
    npcs: [...(z.npcs || [])].map(id => world.npcs.get(id)).filter(Boolean).map(n => ({ id: n.id, name: n.name, sex: n.sex, npc_type: n.npc_type, description: n.description, faction: n.faction })),
    enemies: [...(z.enemies || [])].map(id => world.enemies?.get?.(id)).filter(Boolean).map(e => ({ id: e.id, name: e.name, hp: e.hp, hp_max: e.hp_max ?? e.max_hp, description: e.description })),
    steps,
  };
  console.log(`· ${key}: ${z.name} — ${steps.map(s => `${s.cmd} → ${s.result?.type}`).join(', ')}`);
}

const p = me();
out.player = Object.fromEntries(['handle', 'hp', 'hp_max', 'stamina', 'stamina_max', 'sanity', 'sanity_max', 'credits', 'radiation', 'hunger', 'thirst'].map(k => [k, p[k]]));

writeFileSync(new URL('./payloads.js', import.meta.url),
  '// Generated by capture.mjs. Real payloads from a headless boot; do not hand-edit.\nwindow.FRAME_PAYLOADS = ' + JSON.stringify(out, null, 1) + ';\n');
console.log('· wrote tools/frame-mock/payloads.js');

removePlayerFromZone(P.id, me().current_zone);
removeLivePlayer(P.id);
for (const t of ['player_flags', 'player_inventory', 'player_skills', 'player_quests', 'player_achievements', 'player_deaths', 'player_npc_relations', 'player_mutations', 'player_drug_state', 'player_corpses', 'jail_prisoners']) {
  await query(`DELETE FROM ${t} WHERE player_id = $1`, [P.id]).catch(() => {});
}
stopAll?.();
await pool.end().catch(() => {});
process.exit(0);
