import { query, logActivity } from '../../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZonePlayers, getDoorForExit, getZoneDoors, spawnEnemySync, world } from '../world.js';
import { getLockTagPublic } from './doors.js';
import { sendToPlayer } from '../messaging.js';
import { getZonePowerStatus, recomputePower, recalcZoneLoad } from '../environment.js';
import { getPlayerSkills, SKILLS } from '../skills.js';
import { describeZone } from './describe.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone } from '../world.js';
import { allExits, exitTargets } from '../exits.js';
import { statCost, raiseStat, RAISABLE_STATS, getNetXp } from '../ip.js';
import { ensureTunables } from '../tunables.js';
import { physicalDescription } from '../appearance.js';
import { isMisActive } from '../mis.js';
import { availableActions } from '../specializedActions.js';
import { statusLabels } from '../effects.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';
import { carryCapacity, formatWeight } from './inventory.js';
import { fireHook } from '../plugins.js';

async function cmdStats(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load stats.' };
  const { total, net } = await getNetXp(player.id);

  const playerSkills = await getPlayerSkills(player.id);
  const STAT_ABBR = { stat_brawn:'BRW', stat_reflexes:'REF', stat_brains:'BRN', stat_cool:'COO', stat_endurance:'END' };
  const skillGroups = ['combat','survival','tech','social','arcane'].map(cat => ({
    category: cat,
    skills: Object.values(SKILLS).filter(s => s.category === cat)
      .map(s => ({
        name: s.name,
        level: playerSkills[s.id]?.level || 0,
        stats: s.stats.map(c => STAT_ABBR[c] || c),
      })),
  }));

  const statusFlags = [];
  if (player.sleeping) statusFlags.push('Asleep');
  if (player.healOverTime?.length) statusFlags.push(`Healing (${player.healOverTime.reduce((s,h)=>s+h.perTick*h.ticksRemaining,0)} HP over ${Math.max(...player.healOverTime.map(h=>h.ticksRemaining))}m)`);
  if (player.wellFedUntil && Date.now() < player.wellFedUntil) statusFlags.push('Well-Fed');
  if (player.hydratedUntil && Date.now() < player.hydratedUntil) statusFlags.push('Hydrated');
  if (p.covered_in_blood) statusFlags.push('Covered in blood');
  statusFlags.push(...statusLabels(player));

  return {
    type: 'stats',
    stats: {
      handle: p.handle,
      archetype: p.archetype || 'No Archetype',
      brawn: p.stat_brawn, reflexes: p.stat_reflexes, brains: p.stat_brains,
      cool: p.stat_cool, endurance: p.stat_endurance,
      carry: formatWeight(carryCapacity(p)),
      net_xp: Math.floor(net), total_xp: total, credits: p.credits,
      stat_cost: statCost(0),
      created_at: p.created_at,
      skills: skillGroups,
      status: statusFlags,
    },
    player: p,
  };
}

async function cmdSkills(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load skills.' };
  const playerSkills = await getPlayerSkills(player.id);
  const STAT_LABEL = { stat_brawn:'BRW', stat_reflexes:'RFL', stat_brains:'BRN', stat_cool:'COO', stat_endurance:'END' };

  const groups = ['combat','survival','tech','social','arcane'].map(cat => ({
    category: cat,
    skills: Object.values(SKILLS).filter(s => s.category === cat).map(s => {
      const ip = playerSkills[s.id]?.ip || 0;
      const level = Math.floor(ip / 100);
      const statBonus = Math.floor(s.stats.reduce((sum, c) => sum + (p[c] || 0), 0) / s.stats.length);
      const buff = 0;
      return {
        name: s.name,
        desc: s.desc,
        stats: s.stats.map(c => STAT_LABEL[c] || c),
        ip,
        ipValue: (ip / 100).toFixed(2),
        level,
        statBonus,
        buff,
        final: level + statBonus + buff,
      };
    }),
  }));

  return { type:'skills', groups };
}

const BODY_SLOTS = ['head','torso','hands','legs','feet'];
// Returns name (verbatim casing) preceded by "a"/"an" unless the last word is plural (ends in s, not ss).
function withArticle(name) {
  const lastWord = name.trim().split(/\s+/).pop();
  if (/s$/i.test(lastWord) && !/ss$/i.test(lastWord)) return name;
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
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
  if (target.posture === 'sitting') {
    const where = target.sittingOn ? `the ${target.sittingOn}` : 'the ground';
    msg += `${isSelf ? 'You are' : `${handle} is`} sitting on ${where}.\n`;
  }
  if (target.posture === 'scavenging') {
    msg += `${isSelf ? 'You are' : `${handle} is`} rummaging around, scavenging the area.\n`;
  }
  if (target.posture === 'butchering') {
    msg += `${isSelf ? 'You are' : `${handle} is`} elbow-deep in a carcass, butchering it.\n`;
  }
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

    // MIS-gated body details + arousal-on-examine — MIS plugin hook.
    const misNotes = await fireHook('player.appearanceMisNotes', { target, viewer, isSelf, broadcast, naked: true });
    if (misNotes) msg += misNotes;

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

  // MIS-gated details for clothed players + arousal-on-examine — MIS plugin hook.
  const clothedMisNotes = await fireHook('player.appearanceMisNotes', { target, viewer, isSelf, broadcast, naked: false, bySlot, layerCounts });
  if (clothedMisNotes) msg += clothedMisNotes;

  return msg.trim();
}

// Qualitative fullness line for a fillable container, from its instance fluid
// state and class capacity. Absent/0 amount reads as empty.
function describeFill(customData, capacity) {
  const amount = customData?.fluid_amount || 0;
  if (amount <= 0 || !capacity) return 'It is empty.';
  const fluid = customData?.fluid_type || 'fluid';
  const pct = (amount / capacity) * 100;
  let level;
  if (pct >= 100) level = 'full';
  else if (pct > 75) level = 'mostly full';
  else if (pct < 25) level = 'mostly empty';
  else level = 'half full';
  return `It is ${level} of ${fluid}.`;
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

  const { rows } = await query(`SELECT pi.id AS inv_id, pi.custom_data, i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) {
    const it = rows[0];
    let msg = `${it.name}\n${it.tags?.description ?? it.description}`;
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'container')) {
      const { describeContainer } = await import('./inventory.js');
      msg += `\n\n${await describeContainer({ id: it.inv_id, name: it.name, tags: it.tags })}`;
    }
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'fillable')) {
      msg += `\n${describeFill(it.custom_data, it.tags.fillable)}`;
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
  const { rows: furnitureRows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2`, [player.current_zone, `%${targetStr}%`]);
  if (furnitureRows.length) {
    let f = furnitureRows[0];
    if (furnitureRows.length > 1) {
      // Multiple furniture match (e.g. several street cams under "cam") — let SIFT
      // disambiguate: prompt when they're distinct, auto-pick when interchangeable.
      const fr = siftResolve(t, furnitureRows);
      if (fr.type === 'ambiguous') {
        createSelectionState(player.id, fr.candidates, { verb: 'examine' });
        return { type:'output', message: formatSelectionPage({ allCandidates: fr.candidates, visibleIndex: 0, pageSize: 5 }) };
      }
      if (fr.type === 'match') f = fr.candidate;
    }
    let msg = `${f.name}\n${f.description}`;
    const furnitureExtra = await fireHook('furniture.describe', f, player);
    if (furnitureExtra) msg += `\n${furnitureExtra}`;
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
    } else if (f.object_type === 'media_deck' || f.flags?.media_deck) {
      const flags = f.flags || {};
      const channelId = flags.channel_id;
      const deckActive = flags.deck_active;

      let channelLabel = null;
      let liveCount = 0;
      if (channelId) {
        const { rows: chRows } = await query(
          'SELECT name, number FROM media_channels WHERE id=$1', [channelId]
        );
        if (chRows.length) channelLabel = `Ch ${chRows[0].number}: ${chRows[0].name}`;
        const { rows: camRows } = await query(
          `SELECT COUNT(*)::int AS cnt FROM media_cameras
           WHERE streaming_channel_id=$1 AND is_streaming=1 AND is_powered=1`,
          [channelId]
        );
        liveCount = camRows[0]?.cnt || 0;
      }

      const isLoad = !!deckActive;
      const isLive = !isLoad && liveCount > 0;

      const liveDot  = isLive
        ? `<span style="color:var(--red);font-weight:bold;letter-spacing:1px">⬤ LIVE</span>`
        : `<span style="color:var(--border)">○ LIVE</span>`;
      const loadDot  = isLoad
        ? `<span style="color:var(--cyan);font-weight:bold;letter-spacing:1px">⬤ LOAD</span>`
        : `<span style="color:var(--border)">○ LOAD</span>`;

      let statusLine;
      if (isLive) {
        const camTag = `<span style="color:var(--text-dim)">${liveCount} cam${liveCount !== 1 ? 's' : ''} online</span>`;
        const chTag  = channelLabel ? `<span style="color:var(--text-dim)">${channelLabel}</span>` : '';
        statusLine = `<span style="color:var(--red)">▶ TRANSMITTING LIVE</span>  ${[chTag, camTag].filter(Boolean).join('  ·  ')}`;
      } else if (isLoad) {
        const { rows: bcRows } = await query(
          'SELECT name FROM media_broadcasts WHERE id=$1', [deckActive]
        );
        const bcName = bcRows[0]?.name || deckActive;
        const chTag  = channelLabel ? `<span style="color:var(--text-dim)">${channelLabel}</span>` : '';
        statusLine = `<span style="color:var(--cyan)">▶ CASSETTE:</span> <span style="color:var(--text)">${bcName}</span>${chTag ? `  ·  ${chTag}` : ''}`;
      } else {
        const chTag = channelLabel ? `<span style="color:var(--text-dim)">${channelLabel}</span>` : '';
        statusLine = `<span style="color:var(--border)">— STANDBY</span>${chTag ? `  ·  ${chTag}` : ''}`;
      }

      // List cassettes currently stored in the deck container.
      const { rows: cassetteRows } = await query(
        `SELECT i.tags FROM player_inventory pi JOIN items i ON i.id = pi.item_id WHERE pi.container_id=$1 ORDER BY i.name`,
        [f.id]
      );
      let cassetteList = '';
      if (cassetteRows.length) {
        const bcIds = cassetteRows.map(r => {
          const t = typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || {});
          return t.broadcast_id;
        }).filter(Boolean);
        let nameMap = {};
        if (bcIds.length) {
          const { rows: bcRows } = await query(
            `SELECT id, name FROM media_broadcasts WHERE id = ANY($1)`, [bcIds]
          );
          for (const b of bcRows) nameMap[b.id] = b.name;
        }
        const lines = bcIds.map(id => {
          const isActive = id === deckActive;
          const label = nameMap[id] || id;
          return isActive
            ? `  <span style="color:var(--cyan)">▶ ${label}</span>`
            : `  <span style="color:var(--text-dim)">◦ ${label}</span>`;
        });
        cassetteList = '\n' + lines.join('\n');
      } else {
        cassetteList = '\n  <span style="color:var(--border)">— empty —</span>';
      }

      const useLink  = `<span class="action-link" data-action="use" data-target="${f.name.toLowerCase()}">use</span>`;
      const ejectLink = deckActive ? `  <span class="action-link" data-action="eject" data-target="">eject</span>` : '';
      msg += `\n<span style="display:inline-flex;gap:18px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:2px;margin:4px 0">${liveDot}${loadDot}</span>\n${statusLine}${cassetteList}\n<span class="text-dim">Actions:</span> ${useLink}${ejectLink}`;
    } else if (f.object_type === 'broadcast_camera') {
      const flags = f.flags || {};
      const camId = flags.camera_id;
      let camStatus = '';
      if (camId) {
        const { rows: camRows } = await query(
          'SELECT is_powered, is_streaming, is_recording, streaming_channel_id FROM media_cameras WHERE id=$1', [camId]
        );
        if (camRows.length) {
          const cam = camRows[0];
          const streaming = cam.is_streaming && cam.is_powered;
          const recording = cam.is_recording && cam.is_powered;
          const chId = cam.streaming_channel_id;
          let chLabel = '';
          if (chId) {
            const { rows: chRows } = await query('SELECT name, number FROM media_channels WHERE id=$1', [chId]);
            if (chRows.length) chLabel = `Ch ${chRows[0].number}: ${chRows[0].name}`;
          }
          const streamDot = streaming
            ? `<span style="color:var(--red);font-weight:bold">⬤ STREAMING</span>`
            : `<span style="color:var(--border)">○ STREAMING</span>`;
          const recDot = recording
            ? `<span style="color:var(--accent2);font-weight:bold">⬤ REC</span>`
            : `<span style="color:var(--border)">○ REC</span>`;
          camStatus = `\n<span style="display:inline-flex;gap:18px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:2px;margin:4px 0">${streamDot}${recDot}</span>`;
          if (chLabel) camStatus += `\n<span style="color:var(--text-dim)">→ ${chLabel}</span>`;
          camStatus += `\n<span class="action-link" data-action="record" data-target="${f.name.toLowerCase()}">record</span>  <span class="action-link" data-action="stream" data-target="${f.name.toLowerCase()}">stream</span>`;
        }
      }
      msg += camStatus;
    } else if (f.object_type === 'generator' || f.object_type === 'junction_box') {
      // Pop the grungy industrial inspection overlay, and give text fallback + actions.
      const genId = f.flags?.generator_id || null;
      let g = null;
      if (genId) {
        const { rows: gr } = await query('SELECT status, capacity_kw, remaining_kw FROM generators WHERE id=$1', [genId]);
        g = gr[0] || null;
      }
      const destroyed = (f.hp ?? 1) <= 0;
      const online = !destroyed && g?.status === 'online';
      const integrityPct = Math.max(0, Math.round(((f.hp ?? 0) / (f.hp_max || 1)) * 100));
      sendToPlayer(player.id, {
        type: 'device_inspect_panel',
        deviceType: f.object_type, name: f.name,
        integrityPct, hp: f.hp, hpMax: f.hp_max,
        online, destroyed,
        capacityKw: g?.capacity_kw ?? null,
        outputKw: g?.remaining_kw ?? null,
        hackable: false,
      });
      const n = f.name.toLowerCase();
      const stateLbl = destroyed
        ? '<span style="color:var(--red)">WRECKED — offline</span>'
        : online ? '<span style="color:var(--green)">Online</span>'
                 : '<span style="color:var(--yellow)">No power</span>';
      const attackLink = `<span class="action-link" data-action="attack" data-target="${n}">attack</span>`;
      const repairLink = destroyed ? `  <span class="action-link" data-action="repair" data-target="${n}">repair</span>` : '';
      msg += `\n<span class="text-dim">Status:</span> ${stateLbl} · integrity ${integrityPct}%\n<span class="text-dim">Actions:</span> ${attackLink}${repairLink}`;
    } else {
      // Generic furniture: posture interactions (sit/lie/lean → "on <name>")
      // plus capability verbs gated on flat tags (read/drink → "<name>"),
      // discovered from the specialized-action registry.
      const n = f.name.toLowerCase();
      const links = [
        ...interactions.map(ix =>
          `<span class="action-link" data-action="${ix}" data-target="on ${n}">${ix}</span>`),
        ...availableActions(f)
          .filter(v => !interactions.includes(v) && !['switch','flip','turn','open'].includes(v))
          .map(v => `<span class="action-link" data-action="${v}" data-target="${n}">${v}</span>`),
      ];
      if (links.length) msg += `\n<span class="text-dim">Actions:</span> ${links.join('  ')}`;
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
    const lootLink   = `<span class="action-link" data-action="loot"  data-target="${s.handle}" title="Loot ${s.handle}">loot</span>`;
    const attackLink = `<span class="action-link" data-action="attack" data-target="${s.handle}" title="Attack ${s.handle}">attack</span>`;
    const pinchLink  = `<span class="action-link" data-action="pinch" data-target="${s.handle}" title="Pinch ${s.handle} awake">pinch</span>`;
    return { type:'examine', message: app + `\n<span class="text-dim">(${s.handle} is asleep.)</span>\n<span class="text-dim">Actions:</span> ${lootLink}  ${attackLink}  ${pinchLink}` };
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
      for (const targetId of exitTargets(zone, examDir)) {
        examDoor = getDoorForExit(targetId, EXAM_OPP[examDir], player.current_zone);
        if (examDoor) break;
      }
    }
    if (examDoor) return describeDoor(examDoor, examDir);
  }

  if (t === 'door') {
    const zone = getZone(player.current_zone);
    const local = getZoneDoors(player.current_zone);
    const farSide = [];
    for (const { dir, target: targetId } of allExits(zone)) {
      const d = getDoorForExit(targetId, EXAM_OPP[dir], zone?.id);
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

async function cmdSpawn(args, player, broadcast) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  const [itemId, zoneArg] = args;
  if (!itemId) return { type: 'error', message: 'Usage: spawn <item_id> [zone_id|here]' };
  const zoneId = (!zoneArg || zoneArg === 'here') ? player.current_zone : zoneArg;
  const { rows } = await query('SELECT id, name FROM items WHERE id=$1', [itemId]);
  if (!rows.length) return { type: 'error', message: `No item "${itemId}".` };
  const itemName = rows[0].name || itemId;
  const invId = `inv_spawn_${Date.now()}`;
  await query('INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)',
    [invId, `_ground_${zoneId}`, itemId]);
  broadcast?.(zoneId, { type: 'zone_event', message: `A ${itemName} appears.`, refresh: true });
  const zoneName = getZone(zoneId)?.name;
  const where = zoneName ? `${zoneName} (${zoneId})` : zoneId;
  logActivity('admin_cmd', player.handle, null, `spawn ${itemId} → ${where}`);
  return { type: 'output', message: `Spawned ${itemName} in ${where}.` };
}

async function cmdSpawnEnemy(args, player, broadcast) {
  if (!['admin', 'dev'].includes(player.role)) return { type: 'error', message: 'Access denied.' };
  const [enemyId, zoneArg] = args;
  if (!enemyId) return { type: 'error', message: 'Usage: spawnenemy <enemy_id> [zone_id|here]' };
  const zoneId = (!zoneArg || zoneArg === 'here') ? player.current_zone : zoneArg;
  if (!world.zones.get(zoneId)) return { type: 'error', message: `Zone "${zoneId}" is not loaded.` };
  const { rows } = await query('SELECT * FROM enemies WHERE id=$1', [enemyId]);
  if (!rows.length) return { type: 'error', message: `No enemy template "${enemyId}".` };
  const instance = spawnEnemySync(rows[0], zoneId);
  broadcast?.(zoneId, { type: 'zone_event', message: `A ${instance.name} appears.`, refresh: true });
  const zoneName = world.zones.get(zoneId)?.name;
  const where = zoneName ? `${zoneName} (${zoneId})` : zoneId;
  logActivity('admin_cmd', player.handle, null, `spawnenemy ${enemyId} → ${where}`);
  return { type: 'output', message: `Spawned ${instance.name} (${instance.instanceId}) in ${where}.` };
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

function cmdCorpses(player) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  const list = [...world.corpses.values()];
  if (!list.length) return { type:'system', message:'No corpses on the map.' };
  const lines = list.map(c => `  ${c.name.padEnd(30)} zone: ${c.zoneId}`).join('\n');
  return { type:'system', message:`<span class="help-header">CORPSES (${list.length})</span>\n${lines}` };
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

  logActivity('admin_cmd', player.handle, null, `teleport → ${targetZoneId}`);
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

  const update = { [result.col]: result.to };
  if (result.hp_max !== undefined) {
    player.hp = result.hp;
    player.hp_max = result.hp_max;
    update.hp = result.hp;
    update.hp_max = result.hp_max;
  }

  const msg = `You invest ${result.cost} XP improving your ${result.stat} (${result.from} → ${result.to}).\nXP remaining: ${Math.floor(result.net_remaining)}`;
  return { type: 'raise', message: msg, player_update: update };
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
  corpses:  (args, raw, player) => cmdCorpses(player),
  teleport: (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  tp:       (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  raise:    (args, raw, player) => cmdRaise(args, player),
  ip:       (args, raw, player) => cmdRaise([], player),
  xp:       (args, raw, player) => cmdRaise([], player),
  spawn:    (args, raw, player, broadcast) => cmdSpawn(args, player, broadcast),
  spawnenemy: (args, raw, player, broadcast) => cmdSpawnEnemy(args, player, broadcast),
};

// Lighting controls are owned by the lighting plugin (registered as specialized
// actions); exported here so that plugin can delegate to the engine logic.
export { cmdSwitch, cmdTurn };
