import { query } from '../../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZonePlayers, getDoorForExit, getZoneDoors, spawnEnemySync, world } from '../world.js';
import { getLockTagPublic } from './doors.js';
import { getZonePowerStatus, recomputePower, recalcZoneLoad, getEnvironmentState } from '../environment.js';
import { getPlayerSkills, SKILLS } from '../skills.js';
import { describeZone } from './describe.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone } from '../world.js';
import { statCost, raiseStat, RAISABLE_STATS, getNetXp } from '../ip.js';
import { ensureTunables } from '../tunables.js';
import { physicalDescription, ejaculateDescription, describeGenitals } from '../appearance.js';
import { isMisActive, isAttractedTo, addHorniness, erectionVisibilityNote, breastVisibilityNote, NIPPLE_HARD, NIPPLE_SOFT } from '../mis.js';
import { availableActions } from '../specializedActions.js';
import { statusLabels } from '../effects.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

async function cmdStats(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load stats.' };
  const radBar = `[${'█'.repeat(Math.floor(p.radiation/10))}${'░'.repeat(10-Math.floor(p.radiation/10))}]`;
  let msg = `<span class="stats-header">${p.handle}</span> — ${p.archetype||'unknown'}\n\n`;
  msg += `HP:     ${p.hp}/${p.hp_max}\nSanity: ${p.sanity}/${p.sanity_max}\nHunger: ${p.hunger}/100\nThirst: ${p.thirst}/100\nRAD:    ${radBar} ${p.radiation}/100\n\n`;
  const { total, net } = await getNetXp(player.id);
  msg += `BRAWN:${p.stat_brawn}  REFL:${p.stat_reflexes}  BRNS:${p.stat_brains}\nCOOL:${p.stat_cool}  END:${p.stat_endurance}\n\nXP: ${Math.floor(net)} (Total: ${total})  Credits: ${p.credits}`;

  const statusFlags = [];
  if (player.sleeping) statusFlags.push('Asleep');
  if (player.healOverTime?.length) statusFlags.push(`Healing (${player.healOverTime.reduce((s,h)=>s+h.perTick*h.ticksRemaining,0)} HP over ${Math.max(...player.healOverTime.map(h=>h.ticksRemaining))}m)`);
  if (player.wellFedUntil && Date.now() < player.wellFedUntil) statusFlags.push('Well-Fed');
  if (player.hydratedUntil && Date.now() < player.hydratedUntil) statusFlags.push('Hydrated');
  if (p.covered_in_blood) statusFlags.push('Covered in blood');
  statusFlags.push(...statusLabels(player));
  if (statusFlags.length) msg += `\n\n<span class="status-flags">${statusFlags.join(' · ')}</span>`;

  return { type:'stats', message:msg, player:p };
}

async function cmdSkills(player) {
  const skills = await getPlayerSkills(player.id);
  let msg = '<span class="skills-header">SKILLS</span>\n\n';
  for (const cat of ['combat','survival','tech','social','arcane']) {
    msg += `<span class="skill-category">${cat.toUpperCase()}</span>\n`;
    for (const skill of Object.values(SKILLS).filter(s=>s.category===cat)) {
      const data = skills[skill.id] || { level:0, ip:0 };
      const bars = Math.min(10, data.level);
      msg += `  ${skill.name.padEnd(20)} [${'█'.repeat(bars)}${'░'.repeat(10-bars)}] ${data.level}/10 (${data.ip} IP)\n`;
    }
    msg += '\n';
  }
  return { type:'skills', message:msg };
}

const BODY_SLOTS = ['head','torso','hands','legs','feet'];
// Returns name lowercased, preceded by "a"/"an" unless the last word is plural (ends in s, not ss).
function withArticle(name) {
  const n = name.toLowerCase();
  const lastWord = n.trim().split(/\s+/).pop();
  if (/s$/i.test(lastWord) && !/ss$/i.test(lastWord)) return n;
  return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
}

const STAIN_DESCS = {
  blood: {
    self: [
      (item) => `Your ${item} is smeared with blood. Most of it isn't yours.`,
      (item) => `Your ${item} has blood on it. The butchering didn't go cleanly.`,
      (item) => `There are dark stains across your ${item}. Occupational hazard.`,
      (item) => `Your ${item} is marked with blood. You've been at work.`,
    ],
    other: [
      (item) => `Their ${item} is stained with blood. They've been busy.`,
      (item) => `There's dried blood on their ${item}. You decide not to ask how it got there.`,
      (item) => `Their ${item} bears blood stains. Fresh enough to be interesting.`,
      (item) => `Blood has dried into their ${item}. It wasn't a clean job.`,
    ],
  },
  urine: {
    self: [
      (item) => `Your ${item} has a damp patch that tells a story you'd rather not tell.`,
      (item) => `Your ${item} is stained with what is, let's be honest, urine. Yours.`,
      (item) => `Your ${item} carries the unmistakable evidence of a close call that wasn't close enough.`,
      (item) => `There's a spreading wet stain on your ${item}. The smell confirms your worst suspicions about yourself.`,
    ],
    other: [
      (item) => `Their ${item} is damp in a way that suggests a deeply personal failure.`,
      (item) => `There's a suspicious wet stain on their ${item}. You make a mental note not to ask.`,
      (item) => `Their ${item} bears what appears to be a urine stain. You respect their journey.`,
      (item) => `Something has gone badly wrong with their ${item}. Specifically: a urine situation.`,
    ],
  },
  feces: {
    self: [
      (item) => `Your ${item} is shit stained. A genuine low point in your personal history.`,
      (item) => `Your ${item} is shit stained. Something biological. Something final. Something yours.`,
      (item) => `There's a shit stain on your ${item} that no amount of eye contact will make the other person ignore.`,
      (item) => `Your ${item} is shit stained. The word "compromised" is doing a lot of work here.`,
    ],
    other: [
      (item) => `Their ${item} is shit stained. You weren't prepared for this. Nobody warned you.`,
      (item) => `Their ${item} is shit stained. Something that can't be taken back.`,
      (item) => `Their ${item} is shit stained. You maintain eye contact. You say nothing.`,
      (item) => `There is a shit stain on their ${item} that recontextualizes everything about this encounter.`,
    ],
  },
  ejaculate: {
    self: [
      (item) => `Your ${item} has a sticky white stain on it. You know what it is.`,
      (item) => `There's dried white fluid on your ${item}. Unmistakably sticky.`,
    ],
    other: [
      (item) => `Their ${item} has a sticky white stain on it. You don't comment on it.`,
      (item) => `There's visible dried white fluid on their ${item}. You note it and move on.`,
    ],
  },
  dirt: {
    self: [
      (item) => `Your ${item} is dirt stained. You've been somewhere the ground didn't care about you.`,
      (item) => `Your ${item} is filthy — dirt stained from wherever you've been crawling.`,
    ],
    other: [
      (item) => `Their ${item} is dirt stained. They've been somewhere unpleasant recently.`,
      (item) => `Dirt is ground into their ${item}. The ground won this round.`,
    ],
  },
};

function stainDescription(type, itemName, isSelf) {
  const bucket = STAIN_DESCS[type];
  if (!bucket) return `${isSelf ? 'Your' : 'Their'} ${itemName} is stained with something unpleasant.`;
  const pool = isSelf ? bucket.self : bucket.other;
  return pool[Math.floor(Math.random() * pool.length)](itemName);
}

async function describePlayerAppearance(target, isSelf, viewer = null, broadcast = null) {
  const { rows: equipped } = await query(
    `SELECT i.name, i.tags, pi.layer FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1`,
    [target.id]
  );

  // Count items per slot (for erection layer visibility)
  const layerCounts = {};
  // For each body slot, pick the outermost item (highest pi.layer).
  // Accessories are always all shown, so collect them separately.
  const bySlot = {};
  const accessories = [];
  for (const row of equipped) {
    const slot = row.tags?.slot;
    if (!slot) continue;
    if (slot === 'accessory') {
      accessories.push(row);
      continue;
    }
    layerCounts[slot] = (layerCounts[slot] || 0) + 1;
    const layer = row.layer ?? 0;
    if (!bySlot[slot] || layer > bySlot[slot].layer) {
      bySlot[slot] = { name: row.name, layer, tags: row.tags };
    }
  }

  const handle = target.handle;
  const origin = target.origin_fragment || '';
  const mutated = target.visibly_mutated;

  const bodyPieces = BODY_SLOTS.filter(s => bySlot[s]).map(s =>
    `${withArticle(bySlot[s].name)} on ${isSelf ? 'your' : 'their'} ${s}`
  );
  const weapon = bySlot['weapon_hand'];

  // Physical appearance line (new)
  const physLine = physicalDescription(target, isSelf);

  const DEFAULT_ORIGIN = 'A survivor. Still standing, somehow.';
  let msg = `${origin || DEFAULT_ORIGIN}\n`;
  if (physLine) msg += `${physLine}\n`;
  if (mutated) msg += `<span class="mutation-tag">Something about ${isSelf ? 'you' : 'them'} isn't quite human anymore.</span>\n`;
  if (target.covered_in_blood) msg += `<span style="color:var(--red)">${isSelf ? 'You are' : 'They are'} covered in blood.</span>\n`;

  // MIS gate — used for ejaculate stains and MIS-gated body details below
  const viewerMis = isSelf ? isMisActive(target) : (viewer && isMisActive(viewer));

  // Clothing contamination
  const contamination = target.clothing_contamination || {};
  const stainedSlots = Object.keys(contamination).filter(k => contamination[k] && bySlot[k]);
  if (stainedSlots.length) {
    for (const slot of stainedSlots) {
      const type = contamination[slot];
      if (type === 'ejaculate' && !viewerMis) continue;
      const itemName = bySlot[slot].name;
      const line = stainDescription(type, itemName, isSelf);
      msg += `<span style="color:var(--yellow)">${line}</span>\n`;
    }
  }

  if (!bodyPieces.length && !weapon && !accessories.length) {
    const nakedLines = isSelf
      ? [
          `You have nothing on. Not a thread. You are, in the technical sense, naked.`,
          `You're wearing exactly nothing. It's a look. A bold one.`,
          `You are completely undressed. Whether that's a statement or an oversight isn't clear.`,
        ]
      : [
          `${handle} is wearing nothing. Absolutely nothing. You respect the commitment.`,
          `${handle} has nothing on. Not a stitch. You make a note of this and move on.`,
          `${handle} is completely undressed. They seem unbothered by it.`,
        ];
    msg += nakedLines[Math.floor(Math.random() * nakedLines.length)];

    // MIS details when naked — gated on viewer's MIS (or self's MIS for self-look)
    const viewerForMis = isSelf ? target : (viewer || null);
    if (viewerForMis && isMisActive(viewerForMis)) {
      const envState = getEnvironmentState();
      const genitalDesc = describeGenitals(target, isSelf);
      if (genitalDesc) msg += `\n${genitalDesc}`;
      const ejacNote = ejaculateDescription(target, isSelf, new Set());
      if (ejacNote) msg += `\n${ejacNote}`;
      if (target.biological_sex === 'female') {
        const hard = (target.horniness || 0) > 30 || (envState.tempC !== undefined && envState.tempC < 10);
        const nipplePool = hard
          ? (isSelf ? NIPPLE_HARD.map(s => s.replace(/^Her /i, 'Your ')) : NIPPLE_HARD)
          : (isSelf ? NIPPLE_SOFT.map(s => s.replace(/^Her /i, 'Your ')) : NIPPLE_SOFT);
        msg += `\n${nipplePool[Math.floor(Math.random() * nipplePool.length)]}`;
      }
    }

    // Arousal on examine: viewer sees naked target they're attracted to
    if (!isSelf && viewer && isMisActive(viewer) && isAttractedTo(viewer, target) && broadcast) {
      const arouseMsgs = await addHorniness(viewer, 8, broadcast);
      if (arouseMsgs.length) broadcast(null, { type:'resource_tick', messages: arouseMsgs, player_update: { horniness: viewer.horniness } }, null, viewer.id);
    }

    return msg.trim();
  }

  const sentences = [];
  let namedUsed = false;

  // First sentence uses "Name is ...", subsequent use "They are ..." / "You are ..."
  function subject(nameVerb, theyVerb, youVerb) {
    if (isSelf) return youVerb;
    if (!namedUsed) { namedUsed = true; return `${handle} ${nameVerb}`; }
    return theyVerb;
  }

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  if (bodyPieces.length) {
    sentences.push(cap(`${subject('is wearing', 'they are wearing', 'you are wearing')} ${bodyPieces.join(', ')}.`));
  }

  if (weapon) {
    sentences.push(cap(`${subject('is carrying', 'they are carrying', 'you are carrying')} ${withArticle(weapon.name)}.`));
  }

  if (accessories.length) {
    const place = isSelf ? 'on you' : 'on them';
    const accList = accessories.map(a => withArticle(a.name)).join(', ');
    sentences.push(cap(`${subject('has', 'they have', 'you have')} ${accList} ${place}.`));
  }

  msg += sentences.join(' ');

  // MIS-gated details for clothed players — all gated on viewer's (or self's) MIS
  const coveredSlots = new Set(Object.keys(bySlot));
  if (viewerMis) {
    const ejacNote = ejaculateDescription(target, isSelf, coveredSlots);
    if (ejacNote) msg += `\n${ejacNote}`;
    const envState = getEnvironmentState();
    // Erection visible through ≤3 layers of tight clothing
    const tightSlots = new Set(
      Object.entries(bySlot).filter(([,v]) => v.tags?.bulkiness <= 2).map(([k]) => k)
    );
    const legsLayerCount = layerCounts['legs'] || 0;
    const erectNote = erectionVisibilityNote(target, tightSlots, legsLayerCount);
    if (erectNote) msg += `\n${erectNote}`;

    // Breast/nipple visibility for females
    const torsoLayerCount = layerCounts['torso'] || 0;
    const torsoItem = bySlot['torso'];
    const outermostBulkiness = torsoItem?.tags?.bulkiness || 0;
    const outermostLayerMax = torsoItem?.tags?.allowed_layer_range?.max ?? 99;
    const breastNote = breastVisibilityNote(target, torsoLayerCount, outermostBulkiness, outermostLayerMax, torsoItem?.name, envState.tempC);
    if (breastNote) {
      const breastNoteFixed = isSelf ? breastNote.replace(/\bHer\b/g, 'Your').replace(/\bher\b/g, 'your') : breastNote;
      msg += `\n${breastNoteFixed}`;
    }

    // Show genitals/ass when legs are naked (no leg layer)
    if (legsLayerCount === 0) {
      const genitalDesc = describeGenitals(target, isSelf);
      if (genitalDesc) msg += `\n${genitalDesc}`;
    }

    // Show nipple state for females when torso is naked
    if (target.biological_sex === 'female' && torsoLayerCount === 0) {
      const hard = (target.horniness || 0) > 30 || (envState.tempC !== undefined && envState.tempC < 10);
      const nipplePool = hard
        ? (isSelf ? NIPPLE_HARD.map(s => s.replace(/^Her /i, 'Your ')) : NIPPLE_HARD)
        : (isSelf ? NIPPLE_SOFT.map(s => s.replace(/^Her /i, 'Your ')) : NIPPLE_SOFT);
      msg += `\n${nipplePool[Math.floor(Math.random() * nipplePool.length)]}`;
    }

    // Arousal on examine: visible erection or nipples on attracted viewer
    if (!isSelf && viewer && isMisActive(viewer) && isAttractedTo(viewer, target) && broadcast) {
      const visibleSex = erectNote || breastNote || (legsLayerCount === 0 ? describeGenitals(target, false) : null);
      if (visibleSex) {
        const arouseMsgs = await addHorniness(viewer, 5, broadcast);
        if (arouseMsgs.length) broadcast(null, { type:'resource_tick', messages: arouseMsgs, player_update: { horniness: viewer.horniness } }, null, viewer.id);
      }
    }
  }

  return msg.trim();
}

async function cmdExamine(targetStr, player, broadcast) {
  if (!targetStr || targetStr === 'room') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(player.current_zone) };
  }

  const t = targetStr.toLowerCase();

  // Self-look
  if (t === 'me' || t === 'myself' || t === 'self') {
    return { type:'examine', message: await describePlayerAppearance(player, true, player, broadcast) };
  }

  const { rows } = await query(`SELECT pi.id AS inv_id, i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) {
    const it = rows[0];
    let msg = `${it.name}\n${it.tags?.description ?? it.description}`;
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'container')) {
      const { describeContainer } = await import('./inventory.js');
      msg += `\n\n${await describeContainer({ id: it.inv_id, name: it.name, tags: it.tags })}`;
    }
    const acts = availableActions(it);
    if (acts.length) {
      const links = acts.map(v =>
        `<span class="action-link" data-action="${v}" data-target="${it.name}">${v}</span>`
      ).join('  ');
      msg += `\n<span class="text-dim">Actions:</span> ${links}`;
    }
    return { type:'examine', message: msg };
  }
  const { rows: furnitureRows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${targetStr}%`]);
  if (furnitureRows.length) {
    const f = furnitureRows[0];
    let msg = `${f.name}\n${f.description}`;
    const interactions = f.flags?.interactions || [];
    if (f.object_type === 'light') {
      if (f.light_type === 'streetlight') {
        msg += `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'lit' : 'dark'} — city-grid controlled, no switch out here.</span>`;
      } else {
        msg += `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'on' : 'off'}.</span>`;
        if (interactions.includes('switch')) {
          const n = f.name.toLowerCase();
          const stateDir = f.light_on ? 'off' : 'on';
          const switchLink = `<span class="action-link" data-action="switch" data-target="${stateDir} ${n}">switch ${stateDir}</span>`;
          const turnLink = `<span class="action-link" data-action="turn" data-target="${stateDir} ${n}">turn ${stateDir}</span>`;
          msg += `\n<span class="text-dim">Actions:</span> ${switchLink}  ${turnLink}`;
        }
      }
    } else if (f.object_type === 'container') {
      const n = f.name.toLowerCase();
      const openLink = `<span class="action-link" data-action="open" data-target="${n}">open</span>`;
      msg += `\n<span class="text-dim">Actions:</span> ${openLink}`;
    } else if (interactions.length) {
      const links = interactions.map(ix =>
        `<span class="action-link" data-action="${ix}" data-target="on ${f.name.toLowerCase()}">${ix}</span>`
      ).join('  ');
      msg += `\n<span class="text-dim">Actions:</span> ${links}`;
    }
    return { type:'examine', message: msg };
  }
  const matchAnyGenerator = /generator/i.test(targetStr);
  const { rows: generatorRows } = await query(
    `SELECT * FROM generators WHERE zone_id=$1 AND ($2 OR name ILIKE $3) LIMIT 1`,
    [player.current_zone, matchAnyGenerator, `%${targetStr}%`]
  );
  if (generatorRows.length) {
    const gen = generatorRows[0];
    const { rows: loadRows } = await query(
      `SELECT COALESCE(SUM(current_load_kw),0)::float AS total_load, COUNT(*)::int AS zone_count FROM power_zones WHERE generator_id=$1`,
      [gen.id]
    );
    const totalLoad = loadRows[0]?.total_load || 0;
    const zoneCount = loadRows[0]?.zone_count || 0;
    const statusLabel = gen.status === 'online' ? 'RUNNING' : gen.status.toUpperCase();
    const typeLabel = gen.generator_type === 'city_plant' ? 'city power plant' : gen.generator_type === 'building' ? 'building generator' : 'portable generator';
    let msg = `${gen.name || 'Generator'}\nA permanent ${typeLabel}. No fuel required — it just runs.\n\n` +
      `STATUS: ${statusLabel}\nOUTPUT: ${gen.capacity_kw}kW capacity, ${totalLoad}kW current draw\n` +
      `SERVING: ${zoneCount} zone${zoneCount === 1 ? '' : 's'}`;
    if (totalLoad > gen.capacity_kw) msg += `\n<span class="generator-overload">⚠ OVERLOADED — drawing more than rated capacity.</span>`;
    return { type:'examine', message: msg };
  }
  // Zone entities: enemies, NPCs, live players — combined SIFT pool
  const enemies = getZoneEnemies(player.current_zone);
  const npcs = getZoneNpcs(player.current_zone);
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const zoneEntities = [
    ...enemies.map(e => ({ ...e, _examType: 'enemy' })),
    ...npcs.map(n => ({ ...n, _examType: 'npc' })),
    ...others.map(p => ({ ...p, name: p.handle, _examType: 'player' })),
  ];
  const er = siftResolve(t, zoneEntities);
  if (er.type === 'ambiguous') {
    createSelectionState(player.id, er.candidates, { verb: 'examine' });
    return { type:'output', message: formatSelectionPage({ allCandidates: er.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (er.type === 'match') {
    const c = er.candidate;
    if (c._examType === 'enemy') return { type:'examine', message:`${c.name}\n${c.description}\nHP: ${c.hp}/${c.hp_max}` };
    if (c._examType === 'npc')   return { type:'examine', message:`${c.name}\n${c.description}` };
    if (c._examType === 'player') {
      const app = await describePlayerAppearance(c, false, player, broadcast);
      const stealLink  = `<span class="action-link" data-action="steal" data-target="${c.handle}" title="Steal from ${c.handle}">steal</span>`;
      const attackLink = `<span class="action-link" data-action="attack" data-target="${c.handle}" title="Attack ${c.handle}">attack</span>`;
      return { type:'examine', message: app + `\n<span class="text-dim">Actions:</span> ${stealLink}  ${attackLink}` };
    }
  }
  // No live entity matched — check sleeping/offline players
  const { rows: sleepers } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${t}%`, player.current_zone]
  );
  if (sleepers.length) {
    const s = sleepers[0];
    const app = await describePlayerAppearance(s, false, player, broadcast);
    const lootLink = `<span class="action-link" data-action="loot" data-target="${s.handle}" title="Loot ${s.handle}">loot</span>`;
    const attackLink = `<span class="action-link" data-action="attack" data-target="${s.handle}" title="Attack ${s.handle}">attack</span>`;
    return { type:'examine', message: app + `\n<span class="text-dim">(${s.handle} is asleep.)</span>\n<span class="text-dim">Actions:</span> ${lootLink}  ${attackLink}` };
  }

  // Door examination: "examine door", "examine north", "examine door north", "examine north door"
  const EXAM_DIRS = ['north','south','east','west','up','down','in','out'];
  const EXAM_OPP  = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

  function describeDoor(examDoor, dirHint) {
    const lockTag  = getLockTagPublic(examDoor);
    const hpLine   = examDoor.hp <= 0 ? 'destroyed' : `${examDoor.hp}/${examDoor.hp_max} HP`;
    const stateStr = examDoor.hp > 0 ? (examDoor.is_open ? 'open' : 'closed') : '';
    const lockStr  = lockTag
      ? ` · ${lockTag.type.replace('lock:', '')} [${examDoor.lock_state ?? 'no state'}]`
      : ' · no lock';
    let msg = `${examDoor.name || 'Door'} (${examDoor.door_type})\n${hpLine}${stateStr ? `, ${stateStr}` : ''}${lockStr}`;
    const acts = examDoor.hp > 0 ? ['open', 'close'] : [];
    if (lockTag && examDoor.hp > 0) acts.push('lock', 'unlock');
    if (!lockTag && examDoor.hp > 0) acts.push('install');
    if (lockTag && examDoor.hp > 0) acts.push('uninstall');
    if (acts.length && dirHint) {
      const links = acts.map(v => `<span class="action-link" data-action="${v}" data-target="door ${dirHint}">${v}</span>`).join('  ');
      msg += `\n<span class="text-dim">Actions:</span> ${links}`;
    }
    return { type: 'examine', message: msg };
  }

  const examDir = EXAM_DIRS.find(d => t === d || t === `door ${d}` || t === `${d} door`);
  if (examDir) {
    const zone = getZone(player.current_zone);
    let examDoor = getDoorForExit(player.current_zone, examDir);
    if (!examDoor) {
      const targetId = zone?.exits?.[examDir];
      if (targetId) examDoor = getDoorForExit(targetId, EXAM_OPP[examDir]) || null;
    }
    if (examDoor) return describeDoor(examDoor, examDir);
  }

  if (t === 'door') {
    const zone = getZone(player.current_zone);
    const local = getZoneDoors(player.current_zone);
    const farSide = [];
    for (const [dir, targetId] of Object.entries(zone?.exits || {})) {
      const d = getDoorForExit(targetId, EXAM_OPP[dir]);
      if (d && !local.find(x => x.id === d.id)) farSide.push({ door: d, dir });
    }
    const localWithDir = local.map(d => ({ door: d, dir: d.exit_dir }));
    const all = [...localWithDir, ...farSide];
    if (all.length === 1) return describeDoor(all[0].door, all[0].dir);
    if (all.length > 1) {
      const dirs = all.map(e => e.dir).join(', ');
      return { type: 'error', message: `Multiple doors here — specify a direction (${dirs}).` };
    }
  }

  return { type:'error', message:`You don't see "${targetStr}" here.` };
}

async function cmdSpawn(args, player) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  const [itemId, zoneArg] = args;
  if (!itemId) return { type: 'error', message: 'Usage: spawn <item_id> [zone_id|here]' };
  const zoneId = (!zoneArg || zoneArg === 'here') ? player.current_zone : zoneArg;
  const { rows } = await query('SELECT id FROM items WHERE id=$1', [itemId]);
  if (!rows.length) return { type: 'error', message: `No item "${itemId}".` };
  const invId = `inv_spawn_${Date.now()}`;
  await query('INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)',
    [invId, `_ground_${zoneId}`, itemId]);
  return { type: 'output', message: `Spawned ${itemId} in ${zoneId}.` };
}

async function cmdSpawnEnemy(args, player) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  const [enemyId, zoneArg] = args;
  if (!enemyId) return { type: 'error', message: 'Usage: spawnenemy <enemy_id> [zone_id|here]' };
  const zoneId = (!zoneArg || zoneArg === 'here') ? player.current_zone : zoneArg;
  if (!world.zones.get(zoneId)) return { type: 'error', message: `Zone "${zoneId}" is not loaded.` };
  const { rows } = await query('SELECT * FROM enemies WHERE id=$1', [enemyId]);
  if (!rows.length) return { type: 'error', message: `No enemy template "${enemyId}".` };
  const instance = spawnEnemySync(rows[0], zoneId);
  return { type: 'output', message: `Spawned ${instance.name} (${instance.instanceId}) in ${zoneId}.` };
}

async function applyLightSwitch(nameStr, dir, player, broadcast) {
  if (!nameStr) return { type:'error', message:'Specify a light name.' };
  const { rows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND object_type='light' AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${nameStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't see a light called "${nameStr}" here.` };
  const light = rows[0];
  if (light.light_type === 'streetlight') {
    return { type:'error', message:`${light.name} is city-grid infrastructure — it comes on by itself once it gets dark. There's no switch out here.` };
  }
  const newState = dir ? (dir === 'on' ? 1 : 0) : (light.light_on ? 0 : 1);
  if (light.light_on === newState) {
    return { type:'message', message:`${light.name} is already ${newState ? 'on' : 'off'}.` };
  }
  const powerStatus = getZonePowerStatus(player.current_zone);
  if (powerStatus === 'unpowered' && newState === 1) {
    return { type:'error', message:`The switch clicks, but nothing happens. No power reaches this room.` };
  }
  await query(`UPDATE furniture SET light_on=$1 WHERE id=$2`, [newState, light.id]);
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`,
    [player.current_zone]
  );
  await query(`UPDATE lighting_states SET fixture_count=$1, total_lumens=$2 WHERE zone_id=$3`, [countRows[0]?.cnt || 0, countRows[0]?.lm || 0, player.current_zone]).catch(()=>{});
  await recalcZoneLoad(query, player.current_zone).catch(()=>{});
  await recomputePower().catch(()=>{});
  const flipMsg = newState
    ? `You flip the switch. ${light.name} flickers on.`
    : `You flip the switch. ${light.name} goes dark.`;
  const otherMsg = newState
    ? `${light.name} flickers on.`
    : `${light.name} goes dark.`;
  if (broadcast) broadcast(player.current_zone, { type: 'zone_event', message: otherMsg, refresh: true }, player.id);
  const zone = getZone(player.current_zone);
  const lookMsg = await describeZone(zone, player);
  return { type:'look', message: lookMsg, notify: flipMsg, zone: player.current_zone, minimap: getMinimapData(player.current_zone) };
}

// "switch on/off <name>" or "switch <name> on/off" or "switch <name>" (toggle)
async function cmdSwitch(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Usage: switch on/off <light name>' };
  const words = targetStr.split(' ');
  const first = words[0].toLowerCase();
  const last  = words[words.length - 1].toLowerCase();
  let dir = null;
  let nameStr;
  if (first === 'on' || first === 'off') {
    dir = first;
    nameStr = words.slice(1).join(' ');
  } else if (last === 'on' || last === 'off') {
    dir = last;
    nameStr = words.slice(0, -1).join(' ');
  } else {
    nameStr = targetStr; // no direction — toggle
  }
  return applyLightSwitch(nameStr, dir, player, broadcast);
}

// "turn on/off <name>" or "turn <name> on/off"
async function cmdTurn(args, player, broadcast) {
  const first = args[0]?.toLowerCase();
  const last  = args[args.length - 1]?.toLowerCase();
  let dir, nameStr;
  if (first === 'on' || first === 'off') {
    dir = first;
    nameStr = args.slice(1).join(' ');
  } else if (last === 'on' || last === 'off') {
    dir = last;
    nameStr = args.slice(0, -1).join(' ');
  } else {
    return { type:'error', message:'Usage: turn on/off <light name> — or — turn <light name> on/off' };
  }
  return applyLightSwitch(nameStr, dir, player, broadcast);
}

async function cmdTeleport(targetZoneId, player, broadcast) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  if (!targetZoneId) return { type:'error', message:'Teleport where? Usage: teleport <zone id>' };
  const targetZone = getZone(targetZoneId);
  if (!targetZone) return { type:'error', message:`No zone with id "${targetZoneId}" exists.` };

  const oldZoneId = player.current_zone;
  removePlayerFromZone(player.id, oldZoneId);
  addPlayerToZone(player.id, targetZoneId);
  player.current_zone = targetZoneId;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetZoneId, player.id]);

  broadcast(oldZoneId, { type:'zone_event', message:`${player.handle} vanishes in a flicker of static.` }, player.id);
  broadcast(targetZoneId, { type:'zone_event', message:`${player.handle} flickers into existence out of nowhere.` }, player.id);

  return { type:'move', message: await describeZone(targetZone, player), zone: targetZoneId, minimap: getMinimapData(targetZoneId) };
}

function cmdHelp(player) {
  let msg = `<span class="help-header">COMMANDS</span>

<span class="help-category">MOVEMENT</span>    north south east west up down (n/s/e/w/u/d)  |  go &lt;dir&gt;
<span class="help-category">COMBAT</span>      attack &lt;target&gt;  |  loot &lt;corpse&gt;
<span class="help-category">ITEMS</span>       inventory  take &lt;item&gt;  drop  use  equip
<span class="help-category">CONTAINERS</span>  look in &lt;container&gt;  |  stow &lt;item&gt; in &lt;container&gt;  |  pull &lt;item&gt; from &lt;container&gt;
<span class="help-category">CRAFTING</span>    recipes  |  craft &lt;recipe_id&gt;
<span class="help-category">TRADING</span>     shop &lt;npc&gt;  |  buy &lt;item&gt;  |  sell &lt;item&gt;
<span class="help-category">ECONOMY</span>     balance  |  deposit &lt;amt/all&gt;  |  withdraw &lt;amt/all&gt;  (ATM required)  |  steal &lt;player&gt;
<span class="help-category">PROPERTY</span>    rent  |  lock  |  unlock  |  pick  |  upgrade lock  |  sleep
<span class="help-category">CHARACTER</span>   stats  skills  raise [stat]  mutations  factions
<span class="help-category">SOCIAL</span>      talk &lt;npc&gt;  |  say &lt;message&gt;  |  who  |  whisper/tell &lt;player&gt; &lt;msg&gt;
<span class="help-category">WORLD</span>       map  |  switch on/off &lt;light&gt;  |  turn on/off &lt;light&gt;
<span class="help-category">POSTURE</span>     sit  |  sit on &lt;furniture/floor&gt;  |  lie  |  lie on &lt;furniture&gt;  |  kneel  |  stand
<span class="help-category">EMOTES</span>      smile  frown  laugh  cry  sigh  nod  shake  dance  pace  stretch  wave  shrug  point
<span class="help-category">INTERACT</span>    lean on &lt;furniture&gt;  |  greet [player]  |  follow &lt;player&gt;  |  reflect
<span class="help-category">OBSERVE</span>     look sky  |  look ground  |  look distance  |  examine surroundings
<span class="help-category">INFO</span>        look  |  look &lt;me/item/player&gt;  |  examine &lt;thing&gt;  help`;
  if (player?.role === 'admin') {
    msg += `\n<span class="help-category">ADMIN</span>      teleport &lt;zone id&gt;  (tp)  |  spawn &lt;item id&gt; [zone|here]  |  spawnenemy &lt;enemy id&gt; [zone|here]`;
  }
  return { type:'help', message: msg };
}

async function cmdRaise(args, player) {
  await ensureTunables();
  const statName = args[0]?.toLowerCase();

  const { rows } = await query(
    'SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool FROM players WHERE id=$1',
    [player.id]
  );
  const p = rows[0];

  if (!statName) {
    const { net } = await getNetXp(player.id);
    let msg = `<span class="help-header">EXPERIENCE — ${Math.floor(net)} XP available</span>\n\n`;
    for (const stat of RAISABLE_STATS) {
      const cur = p[`stat_${stat}`] || 0;
      const cost = statCost(cur);
      msg += `  ${stat.padEnd(12)} ${String(cur).padStart(2)}  →  ${cost} XP\n`;
    }
    msg += `\nUsage: raise <stat>`;
    return { type: 'help', message: msg };
  }

  const result = await raiseStat(player.id, statName);
  if (result.error) return { type: 'error', message: result.error };

  player[result.col] = result.to;

  const msg = `You invest ${result.cost} XP improving your ${result.stat} (${result.from} → ${result.to}).\nXP remaining: ${Math.floor(result.net_remaining)}`;
  return { type: 'raise', message: msg, player_update: { [result.col]: result.to } };
}


export const handlers = {
  examine:  (args, raw, player, broadcast) => cmdExamine(args.join(' '), player, broadcast),
  ex:       (args, raw, player, broadcast) => cmdExamine(args.join(' '), player, broadcast),
  x:        (args, raw, player, broadcast) => cmdExamine(args.join(' '), player, broadcast),
  stats:    (args, raw, player) => cmdStats(player),
  status:   (args, raw, player) => cmdStats(player),
  st:       (args, raw, player) => cmdStats(player),
  skills:   (args, raw, player) => cmdSkills(player),
  help:     (args, raw, player) => cmdHelp(player),
  '?':      (args, raw, player) => cmdHelp(player),
  teleport: (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  tp:       (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  raise:    (args, raw, player) => cmdRaise(args, player),
  ip:       (args, raw, player) => cmdRaise([], player),
  xp:       (args, raw, player) => cmdRaise([], player),
  spawn:    (args, raw, player) => cmdSpawn(args, player),
  spawnenemy: (args, raw, player) => cmdSpawnEnemy(args, player),
};

// Lighting controls are owned by the lighting plugin (registered as specialized
// actions); exported here so that plugin can delegate to the engine logic.
export { cmdSwitch, cmdTurn };
