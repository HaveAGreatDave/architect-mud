import { query, logActivity } from '../../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZonePlayers, getDoorForExit, getZoneDoors, spawnEnemySync, world, getApartment, updateFurniture } from '../world.js';
import { getLockTagPublic } from './doors.js';
import { isApartmentZone, getBuildingName, releaseApartment, findNearestVacantApartment, rehomeNpc, clearNpcResidence } from '../apartments.js';
import { sendToPlayer } from '../messaging.js';
import { getZonePowerStatus, recomputePower, recalcZoneLoad, syncZoneLighting, getGeneratorLoad } from '../environment.js';
import { getPlayerSkills, SKILLS } from '../skills.js';
import { describeZone } from './describe.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone, removeLivePlayer, resolveLanding } from '../world.js';
import { allExits, exitTargets } from '../exits.js';
import { statCost, raiseStat, RAISABLE_STATS, getNetXp, maxHpForEndurance } from '../ip.js';
import { ensureTunables } from '../tunables.js';
import { physicalDescription, soilDescription, randomAppearance } from '../appearance.js';
import { isMisActive } from '../mis.js';
import { availableActions } from '../specializedActions.js';
import { genericFurnitureLinks, furnitureVerbs, verbTarget } from '../furnitureActions.js';
import { statusLabels } from '../effects.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';
import { carryCapacity, formatWeight } from './inventory.js';
import { fireHook } from '../plugins.js';

// Naked body descriptions shown when every clothing layer is peeled. Split by sex
// and gated by the viewer's MIS opt-in: MIS-off gets a plain "they're naked" line,
// MIS-on gets an explicit one. tame[i] and graphic[i] describe the SAME body, so a
// given NPC reads consistently in either mode. The variant is chosen by a stable
// hash of the NPC id, so repeated looks at the same NPC always show the same line.
const NAKED_DESC = {
  female: {
    tame: [
      (n) => `${n} is completely naked, standing bare and unselfconscious.`,
      (n) => `${n} wears nothing at all, skin cool under the light.`,
      (n) => `${n} is stripped down to nothing, arms loose at their sides.`,
      (n) => `${n} stands fully nude, unbothered by the exposure.`,
      (n) => `${n} is naked as the day they were born.`,
    ],
    graphic: [
      (n) => `${n} is completely naked — full breasts, stiff nipples, a neat thatch of hair between their thighs.`,
      (n) => `${n} wears nothing at all, heavy breasts swaying, hips bare down to the smooth curve of their sex.`,
      (n) => `${n} is stripped down to nothing, soft breasts and a flat stomach above the shadow of hair at their thighs.`,
      (n) => `${n} stands fully nude, nipples tight in the cool air, thighs parting on a glimpse of everything.`,
      (n) => `${n} is naked as the day they were born, breasts and bare cunt on open display.`,
    ],
  },
  male: {
    tame: [
      (n) => `${n} is completely naked, not a stitch on them.`,
      (n) => `${n} wears nothing at all, standing entirely unbothered.`,
      (n) => `${n} is stripped down to nothing, arms loose at their sides.`,
      (n) => `${n} stands fully nude, exposed and indifferent to it.`,
      (n) => `${n} is naked as the day they were born.`,
    ],
    graphic: [
      (n) => `${n} is completely naked — broad chest, a trail of hair down a flat stomach, cock hanging heavy between their thighs.`,
      (n) => `${n} wears nothing at all, everything on display, soft and uncut against one thigh.`,
      (n) => `${n} is stripped down to nothing, bare from the chest to the blunt weight of their cock.`,
      (n) => `${n} stands fully nude, muscle and old scars and a thick length swinging as they shift.`,
      (n) => `${n} is naked as the day they were born, cock and balls out in the open air.`,
    ],
  },
};

// Stable non-negative hash of a string, so an NPC's naked-line variant never
// changes between looks.
function stableHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function nakedDescLine(npc, viewer) {
  const bucket = NAKED_DESC[npc.sex === 'female' ? 'female' : 'male'];
  const pool = bucket[viewer && isMisActive(viewer) ? 'graphic' : 'tame'];
  const idx = stableHash(npc.id || npc.name || '') % pool.length;
  return pool[idx](npc.name);
}

// Descriptive layered clothing for NPCs. `flags.clothing_layers` is an authored,
// ordered outfit (outermost → innermost). Runtime `_clothingPeeled` (in-memory,
// e.g. managed by the strippers plugin as tips escalate) is how many outer layers
// are currently off. Others see only the outermost still-on garment — or, once
// every layer is peeled, a sex- and MIS-appropriate naked description. NPCs
// without the flag get no line at all (their static description covers them).
function npcClothingLine(npc, viewer) {
  const layers = Array.isArray(npc.flags?.clothing_layers) ? npc.flags.clothing_layers : null;
  if (!layers || !layers.length) return '';
  const peeled = Math.max(0, Math.min(layers.length, npc._clothingPeeled || 0));
  const visible = layers.slice(peeled);
  if (!visible.length) return `\n<span class="text-dim">${nakedDescLine(npc, viewer)}</span>`;
  return `\n<span class="text-dim">${npc.name} is wearing ${visible[0]}.</span>`;
}

export async function cmdStats(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load stats.' };
  const { total, net } = await getNetXp(player.id);

  const playerSkills = await getPlayerSkills(player.id);
  const STAT_ABBR = { stat_brawn:'BRW', stat_reflexes:'REF', stat_brains:'BRN', stat_cool:'COO', stat_endurance:'END', stat_senses:'SEN' };
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
      cool: p.stat_cool, endurance: p.stat_endurance, senses: p.stat_senses,
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

export async function cmdSkills(player) {
  // The live player object already carries the six stat_* columns — the only
  // fields this panel reads — so no row refetch.
  const p = player;
  const playerSkills = await getPlayerSkills(player.id);
  const STAT_LABEL = { stat_brawn:'BRW', stat_reflexes:'RFL', stat_brains:'BRN', stat_cool:'COO', stat_endurance:'END', stat_senses:'SEN' };

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

  // No canned filler when blank — an undescribed player (e.g. fresh out of the
  // prologue, before ever using .describe) simply has no origin line at all.
  let msg = origin ? `${origin}\n` : '';
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
  if (target.posture === 'fishing') {
    msg += `${isSelf ? 'You are' : `${handle} is`} fishing, line cast out over the water.\n`;
  }
  if (target.posture === 'mining') {
    msg += `${isSelf ? 'You are' : `${handle} is`} chipping at the rock face, mining the deposit.\n`;
  }
  if (mutated) msg += `<span class="mutation-tag">Something about ${isSelf ? 'you' : 'them'} isn't quite human anymore.</span>\n`;
  if (target.covered_in_blood) msg += `<span style="color:var(--red)">${isSelf ? 'You are' : 'They are'} covered in blood.</span>\n`;

  // Transient appearance notes from plugins (e.g. cannabis red eyes). Mirrors the
  // player.appearanceMisNotes hook below; plugin returns a line or undefined.
  const notes = await fireHook('player.appearanceNotes', { target, viewer, isSelf });
  if (notes) msg += `${notes}\n`;

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

  // Bare-skin urine/feces residue — the fallback when a targeted body part had
  // no garment to soak (stainCreatureBodyPart in engine/bodily.js).
  const soilNote = soilDescription(target, isSelf, new Set(Object.keys(bySlot)));
  if (soilNote) msg += `<span style="color:var(--yellow)">${soilNote}</span>\n`;

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

// The verbs an inventory item affords — the single source shared by `examine`
// and `help <item>`, so the two never disagree. `equip`/`unequip` for anything
// with a body `slot` (state-aware from is_equipped), then the tag-gated
// specialized actions (eat/drink/use/read/smoke/…) the item's tags unlock.
function itemActionVerbs(it) {
  const verbs = [];
  if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'slot')) {
    verbs.push(it.is_equipped ? 'unequip' : 'equip');
  }
  for (const v of availableActions(it)) if (!verbs.includes(v)) verbs.push(v);
  // A currency chip is `consumable` (so the credit-payout path fires), which the
  // food plugin surfaces as "eat". You don't eat a credit chip — you `use` it to
  // bank it, so swap the consumable verbs for the plain `use` the payout keys on.
  if (it.tags?.currency) {
    const cleaned = verbs.filter(v => v !== 'eat' && v !== 'drink');
    if (!cleaned.includes('use')) cleaned.push('use');
    return cleaned;
  }
  return verbs;
}

async function cmdExamine(targetStr, player, broadcast) {
  if (!targetStr || targetStr === 'room') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(player.current_zone, 8, player) };
  }

  const t = targetStr.toLowerCase();

  // Self-look
  if (t === 'me' || t === 'myself' || t === 'self') {
    return { type:'examine', message: await describePlayerAppearance(player, true, player, broadcast) };
  }

  const { rows } = await query(`SELECT pi.id AS inv_id, pi.custom_data, pi.is_equipped, i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) {
    const it = rows[0];
    let msg = `<span class="zone-name">${it.name}</span>\n${it.tags?.description ?? it.description}`;
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'container')) {
      const { describeContainer } = await import('./inventory.js');
      msg += `\n\n${await describeContainer({ id: it.inv_id, name: it.name, tags: it.tags })}`;
    }
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'fillable')) {
      msg += `\n${describeFill(it.custom_data, it.tags.fillable)}`;
    }
    const acts = itemActionVerbs(it);
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
    let msg = `<span class="zone-name">${f.name}</span>\n${f.description}`;
    const furnitureExtra = await fireHook('furniture.describe', f, player);
    if (furnitureExtra) msg += `\n${furnitureExtra}`;
    const interactions = f.flags?.interactions || [];
    if (f.object_type === 'light') {
      if (f.light_type === 'streetlight') {
        msg += `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'lit' : 'dark'} — city-grid controlled, no switch out here.</span>`;
      } else {
        msg += `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'on' : 'off'}.</span>`;
        const acts = [];
        if (interactions.includes('switch')) {
          const n = f.name.toLowerCase();
          const stateDir = f.light_on ? 'off' : 'on';
          acts.push(`<span class="action-link" data-action="switch" data-target="${stateDir} ${n}">switch ${stateDir}</span>`);
          acts.push(`<span class="action-link" data-action="turn" data-target="${stateDir} ${n}">turn ${stateDir}</span>`);
        }
        acts.push(...genericFurnitureLinks(f, ['switch', 'flip', 'turn']));
        if (acts.length) msg += `\n<span class="text-dim">Actions:</span> ${acts.join('  ')}`;
      }
    } else if (f.object_type === 'container') {
      const n = f.name.toLowerCase();
      const acts = [`<span class="action-link" data-action="open" data-target="${n}">open</span>`, ...genericFurnitureLinks(f, ['open'])];
      msg += `\n<span class="text-dim">Actions:</span> ${acts.join('  ')}`;
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
      const deckExtra = genericFurnitureLinks(f, ['use', 'eject']);
      const deckExtraStr = deckExtra.length ? `  ${deckExtra.join('  ')}` : '';
      msg += `\n<span style="display:inline-flex;gap:18px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:2px;margin:4px 0">${liveDot}${loadDot}</span>\n${statusLine}${cassetteList}\n<span class="text-dim">Actions:</span> ${useLink}${ejectLink}${deckExtraStr}`;
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
          const camExtra = genericFurnitureLinks(f, ['record', 'stream']);
          camStatus += `\n<span class="action-link" data-action="record" data-target="${f.name.toLowerCase()}">record</span>  <span class="action-link" data-action="stream" data-target="${f.name.toLowerCase()}">stream</span>${camExtra.length ? `  ${camExtra.join('  ')}` : ''}`;
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
      const genExtra = genericFurnitureLinks(f, ['attack', 'repair']);
      const genExtraStr = genExtra.length ? `  ${genExtra.join('  ')}` : '';
      msg += `\n<span class="text-dim">Status:</span> ${stateLbl} · integrity ${integrityPct}%\n<span class="text-dim">Actions:</span> ${attackLink}${repairLink}${genExtraStr}`;
    } else {
      // Generic furniture: every affordance the piece declares, from one source
      // of truth — flags.interactions (sit/lie/lean → "on <name>") plus the
      // tag-gated specialized-action registry (read/drink → "<name>").
      const links = genericFurnitureLinks(f);
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
    // current_load_kw is RAM-only derived state (the power sim stopped
    // persisting it), so this reads the live model rather than the DB column —
    // which would otherwise be frozen at whatever it last held.
    const { totalLoad, zoneCount } = getGeneratorLoad(gen.id);
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
    if (c._examType === 'enemy') {
      const attackLink = `<span class="action-link" data-action="attack" data-target="${c.name}" title="Attack ${c.name}">attack</span>`;
      return { type:'examine', message:`${c.name}\n${c.description}\nHP: ${c.hp}/${c.hp_max}\n<span class="text-dim">Actions:</span> ${attackLink}` };
    }
    if (c._examType === 'npc') {
      let postureLine = '';
      if (c._ai?.homeSleeping) {
        const where = c.sittingOn ? `the ${c.sittingOn}` : 'the floor';
        postureLine = `\n<span class="text-dim">${c.name} is asleep on ${where}.</span>`;
      } else if (c.posture === 'lying') {
        const where = c.sittingOn ? `the ${c.sittingOn}` : 'the floor';
        postureLine = `\n<span class="text-dim">${c.name} is lying on ${where}.</span>`;
      }
      const talkLink   = `<span class="action-link" data-action="talk" data-target="${c.name}" title="Talk to ${c.name}">talk</span>`;
      const attackLink = `<span class="action-link" data-action="attack" data-target="${c.name}" title="Attack ${c.name}">attack</span>`;
      return { type:'examine', message:`${c.name}\n${c.description}${postureLine}${npcClothingLine(c, player)}\n<span class="text-dim">Actions:</span> ${talkLink}  ${attackLink}` };
    }
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

// Admin force-set of a player's home (the zone their `home` verb walks back to).
// Bypasses the ownership gate the player-facing `home` bind enforces, and works
// on an online or offline target. Sets home_zone only — anchor_zone (respawn) is
// a separate seam. `here` (or omitted) = the admin's current zone.
async function cmdAdminSetHome(args, player) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  const [handle, zoneArg] = args;
  if (!handle) return { type:'error', message:'Usage: sethome <player> [zone_id|here]' };
  const zoneId = (!zoneArg || zoneArg === 'here') ? player.current_zone : zoneArg;
  if (!getZone(zoneId)) return { type:'error', message:`No zone "${zoneId}".` };
  const { rows } = await query('SELECT id, handle FROM players WHERE LOWER(handle)=$1 LIMIT 1', [handle.toLowerCase()]);
  if (!rows.length) return { type:'error', message:`No player "${handle}".` };
  const target = rows[0];
  await query('UPDATE players SET home_zone=$1 WHERE id=$2', [zoneId, target.id]);
  const live = world.players.get(target.id);
  if (live) live.home_zone = zoneId;
  const zoneName = getZone(zoneId)?.name;
  const where = zoneName ? `${zoneName} (${zoneId})` : zoneId;
  logActivity('admin_cmd', player.handle, null, `sethome ${target.handle} → ${where}`);
  return { type:'output', message:`Set ${target.handle}'s home to ${where}.` };
}

// Reincarnate: wipe a player back to a brand-new account and drop them into the
// same prologue every fresh registration starts in (zone_the_inbetween — see
// server/api/routes.js apiRegister, which this mirrors). Owned property (aircraft/
// hangars/apartments) is released back to unowned stock rather than deleted
// outright; every other per-player table — inventory, skills, faction rep, quests,
// flags, jail, org membership, insurance, cargo drops, the death log, mutations,
// drug state, smuggle orders, active job contracts — is wiped outright. This is a
// true blank slate, not a soft reset, so it deliberately clears history too.
// An online target is KICKED rather than hot-patched: reconstructing a live
// session in place risks missing some in-memory field (cached armor, posture,
// equipped-item lists, …), where a fresh reconnect goes through the exact same
// login path every other player does and can't drift from it.
const REINCARNATE_WIPE_TABLES = [
  'player_inventory', 'player_skills', 'player_ideology_rep', 'player_mutations',
  'player_drug_state', 'player_flags', 'player_quests', 'player_deaths',
  'player_corpses', 'org_members', 'smuggle_orders', 'flight_contracts', 'jail_prisoners',
];
const REINCARNATE_WIPE_OWNER_TABLES = ['insurance_policies', 'insurance_claims', 'cargo_drops'];

async function cmdReincarnate(args, player) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  const [handle] = args;
  if (!handle) return { type:'error', message:'Usage: reincarnate <player>' };
  const { rows } = await query('SELECT id, handle FROM players WHERE LOWER(handle)=$1 LIMIT 1', [handle.toLowerCase()]);
  if (!rows.length) return { type:'error', message:`No player "${handle}".` };
  const target = rows[0];

  // Release owned property back to unowned stock.
  await query('UPDATE aircraft SET owner_id=NULL, hangar_id=NULL WHERE owner_id=$1', [target.id]);
  await query('DELETE FROM hangars WHERE owner_id=$1', [target.id]);
  await query('UPDATE apartments SET owner_id=NULL, owner_handle=NULL, is_locked=0, purchased_at=NULL, date_rented=NULL WHERE owner_id=$1', [target.id]);

  // Wipe every other per-player table — progress AND history.
  for (const t of REINCARNATE_WIPE_TABLES) await query(`DELETE FROM ${t} WHERE player_id=$1`, [target.id]).catch(() => {});
  for (const t of REINCARNATE_WIPE_OWNER_TABLES) await query(`DELETE FROM ${t} WHERE owner_id=$1`, [target.id]).catch(() => {});

  // Reset the players row itself to exactly what a fresh registration produces
  // (mirrors apiRegister's INSERT — including its literal sexuality default,
  // which is 'Female' regardless of biological_sex; not fixing that quirk here,
  // just faithfully reproducing "as if newly registered").
  const biologicalSex = Math.random() < 0.5 ? 'male' : 'female';
  const app = randomAppearance(biologicalSex);
  const startHp = maxHpForEndurance(0);
  await query(
    `UPDATE players SET
       bonus_xp=0, hp=$1, hp_max=$1, sanity=100, sanity_max=100, hunger=100, thirst=100, radiation=0,
       current_zone='zone_the_inbetween', anchor_zone='zone_start', home_zone=NULL,
       credits=20, bank_credits=0,
       stat_brawn=0, stat_reflexes=0, stat_endurance=0, stat_brains=0, stat_cool=0, stat_senses=0,
       gifted_stat_points=0, stamina=100, stamina_max=100, body_temp_c=37.0,
       visibly_mutated=0, covered_in_blood=0, origin_fragment=NULL, archetype=NULL,
       biological_sex=$2, hair_style=$3, hair_length=$4, hair_color=$5, eye_color=$6,
       height_cm=$7, weight_kg=$8, appearance_data=$9::jsonb, appearance_free_used=0,
       mis_enabled=0, horniness=0, erect=0, digestive_load=0, hydration_load=0,
       clothing_contamination='{}'::jsonb, sexuality='Female',
       mob_kills=0, player_kills=0, deaths=0, offline_sleeping=FALSE, died_offline=FALSE,
       last_seen=EXTRACT(EPOCH FROM NOW())
     WHERE id=$10`,
    [startHp, biologicalSex, app.hair_style, app.hair_length, app.hair_color, app.eye_color,
     app.height_cm, app.weight_kg, JSON.stringify(app.appearance_data), target.id]
  );

  // Kick an online target so their next login rebuilds the live session clean.
  const live = world.players.get(target.id);
  if (live) {
    sendToPlayer(target.id, { type: 'kicked', message: 'The Architect calls everything that was you back for revision. Log in again to begin.' });
    removePlayerFromZone(target.id, live.current_zone);
    removeLivePlayer(target.id);
  }

  logActivity('admin_cmd', player.handle, null, `reincarnate ${target.handle}`);
  return { type:'output', message:`${target.handle} has been reincarnated — wiped to a fresh account, waiting in The Inbetween.${live ? ' (was online — kicked to reconnect clean)' : ''}` };
}

// Admin eviction. Turns a PLAYER out of every personal rental they hold, or an NPC
// out of their home unit — freeing the unit(s) for the next tenant. An evicted NPC
// immediately seeks the nearest vacant apartment (walking distance, so usually one in
// the same building) and moves in, re-registering it as home; if the whole map is full
// they're turned out to the residential lobby. Target is named globally (like sethome),
// player first (resolved by handle), then NPC (by name, exact before unique partial).
async function cmdEvict(args, player) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  const name = args.join(' ').trim();
  if (!name) return { type:'error', message:'Usage: evict <player or npc>' };

  // A player's rental agreement lives in the `apartments` ledger keyed by owner_id.
  const { rows: pRows } = await query('SELECT id, handle, home_zone FROM players WHERE LOWER(handle)=$1 LIMIT 1', [name.toLowerCase()]);
  if (pRows.length) {
    const target = pRows[0];
    const { rows: owned } = await query(
      "SELECT zone_id FROM apartments WHERE owner_id=$1 AND COALESCE(owner_type,'player')='player'", [target.id]);
    if (!owned.length) return { type:'error', message:`${target.handle} isn't renting anywhere.` };
    const freed = [];
    for (const { zone_id } of owned) {
      const apt = getApartment(zone_id);
      if (apt) await releaseApartment(apt, zone_id);
      freed.push(getZone(zone_id)?.name || zone_id);
      // Drop their home bind if it pointed at a unit they just lost, so `home` can't
      // route them back to a place that's no longer theirs.
      if (target.home_zone === zone_id) {
        await query('UPDATE players SET home_zone=NULL WHERE id=$1', [target.id]);
        const live = world.players.get(target.id);
        if (live) live.home_zone = null;
      }
    }
    logActivity('admin_cmd', player.handle, null, `evict ${target.handle} (${freed.length} unit${freed.length===1?'':'s'})`);
    return { type:'output', message:`Evicted ${target.handle} from ${freed.join(', ')}. ${freed.length>1?'Those units are':'That unit is'} available again.` };
  }

  // Otherwise an NPC, matched by name — exact match first, then a single partial.
  const npcs = [...world.npcs.values()];
  const lname = name.toLowerCase();
  let matches = npcs.filter(n => (n.name || '').toLowerCase() === lname);
  if (!matches.length) matches = npcs.filter(n => (n.name || '').toLowerCase().includes(lname));
  if (!matches.length) return { type:'error', message:`No player or NPC called "${name}".` };
  if (matches.length > 1)
    return { type:'error', message:`"${name}" matches ${matches.length} NPCs — be more specific: ${matches.slice(0, 6).map(n => n.name).join(', ')}${matches.length > 6 ? '…' : ''}.` };
  const npc = matches[0];

  const oldZoneId = npc.home_zone;
  if (!oldZoneId || !isApartmentZone(getZone(oldZoneId)))
    return { type:'error', message:`${npc.name} doesn't have an apartment to be evicted from.` };
  const oldName = getZone(oldZoneId)?.name || oldZoneId;

  const newZoneId = await findNearestVacantApartment(oldZoneId, oldZoneId);
  if (!newZoneId) {
    await clearNpcResidence(npc);
    logActivity('admin_cmd', player.handle, null, `evict ${npc.name} → no vacancy`);
    return { type:'output', message:`Evicted ${npc.name} from ${oldName}. No vacant unit anywhere — turned out to the residential lobby. ${oldName} is available again.` };
  }
  await rehomeNpc(npc, newZoneId);
  const newName = getZone(newZoneId)?.name || newZoneId;
  const building = getBuildingName(getZone(newZoneId));
  logActivity('admin_cmd', player.handle, null, `evict ${npc.name}: ${oldZoneId} → ${newZoneId}`);
  return { type:'output', message:`Evicted ${npc.name} from ${oldName} — it's available again. ${npc.name} moved into the nearest vacancy, ${newName}${building ? ` (${building})` : ''}, and now lives there.` };
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
  await updateFurniture(light.id, { light_on: newState });
  syncZoneLighting(player.current_zone);
  recalcZoneLoad(player.current_zone);
  await recomputePower().catch(()=>{});
  const flipMsg = newState
    ? `The ${light.name} flickers on.`
    : `The ${light.name} goes dark.`;
  const otherMsg = newState
    ? `${light.name} flickers on.`
    : `${light.name} goes dark.`;
  if (broadcast) broadcast(player.current_zone, { type: 'zone_event', message: otherMsg, refresh: true }, player.id);
  const zone = getZone(player.current_zone);
  const lookMsg = await describeZone(zone, player);
  return { type:'look', message: lookMsg, notify: flipMsg, zone: player.current_zone, minimap: getMinimapData(player.current_zone, 8, player) };
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
  targetZoneId = resolveLanding(targetZoneId); // facades forward into their interior
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
  return { type:'move', message: await describeZone(targetZone, player), zone: targetZoneId, minimap: getMinimapData(targetZoneId, 8, player) };
}

// The `.admin` command reference. One hand-maintained catalog is the single
// source of truth — admin verbs are role-gated inline in their own handlers
// (scattered across the engine + plugins), so there's nothing to auto-derive
// from. When you add a new admin/dev verb, add a line here. `roles` lists who
// may run it; the panel only shows a viewer the verbs they can actually use.
// `args` empty ⇒ the client runs it on click; otherwise it prefills the input.
const ADMIN_COMMANDS = [
  { verb:'tp',              args:'<zone id>',              desc:'Teleport yourself to a zone.',                       roles:['admin'],                              cat:'World' },
  { verb:'corpses',         args:'',                       desc:'List every corpse currently on the map.',            roles:['admin'],                              cat:'World' },
  { verb:'purge',           args:'',                       desc:'Wipe your wanted stars + heat and combust every cop in the room.', roles:['admin'],                 cat:'World' },
  { verb:'sethome',         args:'<player> [zone|here]',   desc:"Force-set a player's home zone (default: your current zone).",     roles:['admin'],                 cat:'World' },
  { verb:'evict',           args:'<player or npc>',        desc:'End a tenant\'s lease and free the unit. Evicted NPCs move into the nearest vacant apartment.', roles:['admin'],       cat:'World' },
  { verb:'reincarnate',     args:'<player>',               desc:'Wipe a player to a brand-new account, dropped into The Inbetween. Irreversible.', roles:['admin'],       cat:'World' },
  { verb:'lettherebelight', args:'',                       desc:'Add a lit, powered overhead fixture to this room.',  roles:['admin','dev'],                        cat:'World' },
  { verb:'spawn',           args:'<item id> [zone|here]',  desc:'Spawn an item (default: your current zone).',        roles:['admin','dev'],                        cat:'Spawning' },
  { verb:'spawnenemy',      args:'<enemy id> [zone|here]', desc:'Spawn an enemy (default: your current zone).',       roles:['admin','dev'],                        cat:'Spawning' },
  { verb:'kamehameha',      args:'[target]',               desc:'Insta-kill a named enemy, NPC, or player — or every enemy in the room if none named.', roles:['admin'],  cat:'Combat' },
  { verb:'makeitrain',      args:'',                       desc:'The Architect rains ₵100,000 onto your own balance.',  roles:['admin','dev'],                        cat:'World' },
  { verb:'dresscyd',        args:'[save]',                 desc:'Dress the Cyd NPC from the saved outfit (save = snapshot current).', roles:['admin','dev'],           cat:'Content' },
  { verb:'cooktest',        args:'[difficulty] [hard]',    desc:'Open the cook minigame in test mode (no inventory).', roles:['admin','dev','builder','designer'],   cat:'Content' },
  { verb:'splicetest',      args:'',                       desc:'Open the splice designer in test mode.',             roles:['admin','dev','builder','designer'],   cat:'Content' },
  { verb:'invite',          args:'<player>',               desc:'Add a player to The Echelon invite list.',           roles:['admin'],                              cat:'Echelon' },
  { verb:'uninvite',        args:'<player>',               desc:'Remove a player from The Echelon invite list.',      roles:['admin'],                              cat:'Echelon' },
  { verb:'invites',         args:'',                       desc:'List The Echelon invite list.',                      roles:['admin'],                              cat:'Echelon' },
  { verb:'sail',            args:'<n|s|e|w>',              desc:"Steer The Echelon one water tile (from her bridge; 5-min cooldown). No arg shows helm status.", roles:['admin'], cat:'Echelon' },
  { verb:'dock',            args:'',                       desc:'Lower or retract The Echelon gangway to an adjacent pier.', roles:['admin'],                        cat:'Echelon' },
  { verb:'airemergency',    args:'[broadcast id]',         desc:"Seize every tuned TV in Architect with the Echelon's emergency bulletin (from the Emergency Broadcast Console).", roles:['admin','dev'], cat:'Echelon' },
  { verb:'endemergency',    args:'',                       desc:'End the emergency broadcast; normal programming resumes citywide.', roles:['admin','dev'],                cat:'Echelon' },
];

function cmdAdmin(player) {
  if (player.role !== 'admin') {
    return { type:'error', message:'Unknown command: "admin". Type HELP for commands.' };
  }
  const commands = ADMIN_COMMANDS
    .filter(c => c.roles.includes(player.role))
    .map(({ verb, args, desc, cat }) => ({ verb, args, desc, cat }));
  return { type:'admin_panel', role: player.role, commands };
}

// The command reference, as data — the single source shared by both `/help`
// (below) and the Tablet Help app (plugins/tablet/help-app.js). `text` holds raw
// angle brackets; cmdHelp escapes them for its HTML transcript, the tablet esc()s
// them itself. Add or reword a line here and both surfaces update together.
export const HELP_GROUPS = [
  { cat: 'MOVEMENT',   text: 'north south east west up down (n/s/e/w/u/d)  |  go <dir>' },
  { cat: 'COMBAT',     text: 'attack <target>  |  loot <corpse>' },
  { cat: 'ITEMS',      text: 'inventory  take <item>  drop  use  equip' },
  { cat: 'CONTAINERS', text: 'look in <container>  |  stow <item> in <container>  |  pull <item> from <container>' },
  { cat: 'CRAFTING',   text: 'recipes  |  craft <recipe_id>' },
  { cat: 'TRADING',    text: 'shop <npc>  |  buy <item>  |  sell <item>' },
  { cat: 'ECONOMY',    text: 'balance  |  deposit <amt/all>  |  withdraw <amt/all>  (ATM required)  |  steal <player>' },
  { cat: 'PROPERTY',   text: 'rent  |  lock  |  unlock  |  pick  |  upgrade lock  |  sleep' },
  { cat: 'CHARACTER',  text: 'stats  skills  raise [stat]  mutations  ideologies' },
  { cat: 'SOCIAL',     text: 'talk <npc>  |  say <message>  |  who  |  whisper/tell <player> <msg>' },
  { cat: 'WORLD',      text: 'map  |  switch on/off <light>  |  turn on/off <light>' },
  { cat: 'POSTURE',    text: 'sit  |  sit on <furniture/floor>  |  lie  |  lie on <furniture>  |  kneel  |  stand' },
  { cat: 'EMOTES',     text: 'smile  frown  laugh  cry  sigh  nod  shake  dance  pace  stretch  wave  shrug  point' },
  { cat: 'INTERACT',   text: 'lean on <furniture>  |  greet [player]  |  follow <player>  |  reflect' },
  { cat: 'OBSERVE',    text: 'look sky  |  look ground  |  look distance  |  examine surroundings' },
  { cat: 'INFO',       text: 'look  |  look <me/item/player>  |  examine <thing>  help' },
];

// `help <thing>` — the affordance list for a specific item or piece of furniture,
// drawn from the same source examine uses (itemActionVerbs / furnitureVerbs), so
// "what can I do with this" is one answer everywhere. Returns null when nothing
// in reach matches, so cmdHelp can fall back to the general command reference.
async function cmdTargetHelp(targetStr, player) {
  const render = (name, entries) => {
    let msg = `<span class="help-header">${name.toUpperCase()}</span>\n`;
    if (!entries.length) {
      msg += `\n<span class="text-dim">Nothing special to do with this — try</span> examine ${name.toLowerCase()}<span class="text-dim">.</span>`;
      return { type: 'help', message: msg };
    }
    msg += `\n<span class="text-dim">Things you can do:</span>\n`;
    msg += entries.map(e =>
      `  <span class="action-link" data-action="${e.verb}" data-target="${e.target}">${e.verb} ${e.target}</span>`
    ).join('\n');
    return { type: 'help', message: msg };
  };

  // Inventory item first, then furniture in the current zone.
  const { rows } = await query(
    `SELECT pi.is_equipped, i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (rows.length) {
    const it = rows[0];
    return render(it.name, itemActionVerbs(it).map(v => ({ verb: v, target: it.name })));
  }
  const { rows: fr } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${targetStr}%`]
  );
  if (fr.length) {
    const f = fr[0];
    const n = f.name.toLowerCase();
    return render(f.name, furnitureVerbs(f).map(v => ({ verb: v, target: verbTarget(v, n) })));
  }
  return null;
}

async function cmdHelp(args, player) {
  const target = (args || []).join(' ').trim();
  if (target) {
    const specific = await cmdTargetHelp(target, player);
    if (specific) return specific;
    // Nothing in reach matched — fall through to the general command reference.
  }
  const escLt = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let msg = `<span class="help-header">COMMANDS</span>\n`;
  for (const g of HELP_GROUPS) {
    const pad = ' '.repeat(Math.max(1, 12 - g.cat.length));
    msg += `\n<span class="help-category">${g.cat}</span>${pad}${escLt(g.text)}`;
  }
  msg += `\n<span class="help-category">HELP</span>      help &lt;item/furniture&gt;   <span class="text-dim">— what you can do with a specific thing</span>`;
  if (player?.role === 'admin') {
    msg += `\n<span class="help-category">ADMIN</span>      @admin   <span class="text-dim">— open the admin command reference (@ = admin · / = player · . = bookkeeping)</span>`;
  }
  return { type:'help', message: msg };
}

async function cmdRaise(args, player) {
  await ensureTunables();
  const statName = args[0]?.toLowerCase();

  const { rows } = await query(
    'SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses FROM players WHERE id=$1',
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
  stats:    (args, raw, player) => cmdStats(player),
  skills:   (args, raw, player) => cmdSkills(player),
  help:     (args, raw, player) => cmdHelp(args, player),
  corpses:  (args, raw, player) => cmdCorpses(player),
  teleport: (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  raise:    (args, raw, player) => cmdRaise(args, player),
  spawn:    (args, raw, player, broadcast) => cmdSpawn(args, player, broadcast),
  spawnenemy: (args, raw, player, broadcast) => cmdSpawnEnemy(args, player, broadcast),
  sethome:  (args, raw, player) => cmdAdminSetHome(args, player),
  evict:    (args, raw, player) => cmdEvict(args, player),
  reincarnate: (args, raw, player) => cmdReincarnate(args, player),
  admin:    (args, raw, player) => cmdAdmin(player),
};

// Lighting controls are owned by the lighting plugin (registered as specialized
// actions); exported here so that plugin can delegate to the engine logic.
export { cmdSwitch, cmdTurn };
