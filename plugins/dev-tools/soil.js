/**
 * `.soil <target>` — the Architect reaches into somebody's guts and lets go for
 * them. Admin/dev only.
 *
 * It is a GM lever over machinery that already exists rather than a second
 * bodily system: the mark is written with the engine's own stain channels
 * (`stainClothing` when there is a garment to take it, `soilBareSkin` when there
 * is not, `stainZone` for the floor, `taintAir` for the ninety seconds the room
 * has to live with), and the noise is the bodily plugin's own `bodily.sfx` cues,
 * so a soiling sounds exactly like a soiling and nothing new had to be authored.
 *
 * Two deliberate limits:
 *
 *  • An NPC is NOT stained. Stains live on the `players` row and NPCs have no
 *    equivalent — writing one would need a second representation that only this
 *    verb understood. The NPC gets the event, the room, the floor and the smell;
 *    what it does not get is a persistent mark, and that is honest rather than
 *    half-built.
 *
 *  • Severity is rolled, never argued. Three grades (a quiet one, a loud one, a
 *    complete failure of the system) drive the victim's line, the room's line,
 *    the sound and how many bystanders turn round — so the same command twice in
 *    a row does not read as the same command twice in a row.
 */
import { stainClothing, stainZone, soilBareSkin, taintAir } from '../../server/engine/bodily.js';
import { getZonePlayers, getZoneNpcs, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── Voice ────────────────────────────────────────────────────────────────────
// Three grades. Each is a complete set — self line, room line, NPC reactions —
// so the tone holds together instead of a mild noise landing under a catastrophic
// description. Nothing anywhere names the cause: as far as the world is
// concerned this simply happened to them.

const GRADES = [
  {
    key: 'quiet',
    weight: 3,
    intensity: 0.35,
    reactors: 1,
    self: [
      `Something lets go, quietly and without asking, and the day is over.`,
      `A small betrayal, low down, and warm. You don't need to look to know.`,
      `It happens between one breath and the next. No warning. No say in it.`,
      `Your body files a decision it didn't run past you first.`,
    ],
    room: [
      `{name} goes very still, and very carefully doesn't move.`,
      `Something changes in {name}'s face. Then in the air.`,
      `{name} stops mid-step for no reason anyone can see. The reason arrives shortly.`,
      `{name} adopts the posture of somebody hoping the room will move on.`,
    ],
    npc: [
      `wrinkles their nose and drifts a step sideways.`,
      `glances at {name}, then very deliberately at nothing.`,
      `frowns at the air like it owes them money.`,
      `sniffs once, decides against sniffing again.`,
    ],
  },
  {
    key: 'loud',
    weight: 2,
    intensity: 0.7,
    reactors: 2,
    self: [
      `It goes, all of it, loudly, and there's a full second where you can only stand there and be a witness to yourself.`,
      `Your gut cramps once as a courtesy and then empties without further discussion.`,
      `There's a noise. You made it. It's still going.`,
      `Whatever was holding the line down there has resigned, effective immediately.`,
    ],
    room: [
      `{name} makes a sound nobody was ready for, and the smell arrives half a second behind it.`,
      `Something goes badly wrong inside {name}'s clothing, audibly.`,
      `{name} buckles slightly. The room learns why almost at once.`,
      `The conversation stops. {name} is the reason, and everyone works it out together.`,
    ],
    npc: [
      `recoils. "Oh — oh, that's on YOU, that is."`,
      `covers their mouth. "In HERE? Seriously?"`,
      `backs off two full steps without breaking eye contact.`,
      `stares at {name} with open, undisguised betrayal.`,
      `gags, turns away, and pretends to be busy.`,
    ],
  },
  {
    key: 'catastrophic',
    weight: 1,
    intensity: 1,
    reactors: 3,
    self: [
      `Everything goes at once. Everything. You are, briefly, mostly plumbing, and the plumbing has failed.`,
      `There's no build-up and no negotiation. There's simply a before and an after, and you're standing in the after.`,
      `It isn't an accident so much as an evacuation. Your legs are warm. The floor is warmer.`,
      `Your body abandons the whole project. You feel it reach your boots.`,
    ],
    room: [
      `{name} comes apart at the seams, catastrophically and at length, and the floor takes most of it.`,
      `Whatever just happened to {name} keeps happening, and the room fills with the news of it.`,
      `{name} loses the argument with their own body, comprehensively, in public.`,
      `There's a sound like a bag of something being set down too fast, and then {name} is standing in it.`,
    ],
    npc: [
      `shouts, "GET OUT! Get out, get OUT —"`,
      `retches into their sleeve and makes for the door.`,
      `points at the floor, speechless, and keeps pointing.`,
      `abandons a full drink on the table rather than stay another second.`,
      `says, "I have seen a man die and it was nicer than this."`,
    ],
  },
];

// Weighted pick — the quiet one is the common case, the catastrophe is rare
// enough to still land when it comes up.
function rollGrade() {
  const total = GRADES.reduce((n, g) => n + g.weight, 0);
  let r = Math.random() * total;
  for (const g of GRADES) { r -= g.weight; if (r < 0) return g; }
  return GRADES[0];
}

// ── Target resolution ────────────────────────────────────────────────────────
// Room-scoped first (this is a thing you do to somebody in front of you), then a
// global fall-back to any online player by handle so an admin can reach across
// the map. Exact match beats partial; an ambiguous partial says so rather than
// picking for you.

function matchOne(list, needle) {
  const exact = list.filter(c => c.name.toLowerCase() === needle);
  if (exact.length) return { hit: exact[0] };
  const part = list.filter(c => c.name.toLowerCase().includes(needle));
  if (part.length === 1) return { hit: part[0] };
  if (part.length > 1) return { ambiguous: part.map(c => c.name) };
  return {};
}

function resolveTarget(actor, needle) {
  const here = [
    ...getZonePlayers(actor.current_zone).map(p => ({ name: p.handle, being: p, isNpc: false })),
    ...getZoneNpcs(actor.current_zone).filter(n => !n._dead).map(n => ({ name: n.name, being: n, isNpc: true })),
  ];
  const local = matchOne(here, needle);
  if (local.hit || local.ambiguous) return local;

  const online = getAllLivePlayers().map(p => ({ name: p.handle, being: p, isNpc: false }));
  return matchOne(online, needle);
}

// ── The deed ─────────────────────────────────────────────────────────────────

// Where it lands on a player: whatever is worn on the legs takes it, and bare
// legs mean it reaches skin and boots. Never a no-op — being less dressed is not
// a way to stay clean (the same rule soilBareSkin exists for).
async function markPlayer(victim) {
  const { rows } = await query(
    `SELECT slot FROM player_inventory WHERE player_id=$1 AND is_equipped=1 AND slot IN ('legs','feet')`,
    [victim.id]
  );
  const slots = [...new Set(rows.map(r => r.slot))];
  if (slots.length) await stainClothing(victim, slots, 'feces');
  else await soilBareSkin(victim, 'feces', ['legs', 'feet']);
  return slots.length > 0;
}

// The noise, in the order a body makes it: the failure, the landing, the last of
// it. Staggered rather than fired in one frame, because all three at once is a
// single unreadable thump.
function soundOff(zoneId, victimId, grade) {
  const at = (ms, ev) => setTimeout(() => emit('bodily.sfx', { zoneId, playerId: victimId, ...ev }), ms);
  at(0, { cue: 'fart', intensity: grade.intensity });
  at(450 + Math.random() * 250, { cue: 'plop', surface: 'concrete' });
  if (grade.key !== 'quiet') {
    at(1100 + Math.random() * 400, { cue: 'finale', intensity: grade.intensity });
    at(1900 + Math.random() * 500, { cue: 'plop', surface: 'concrete' });
  }
}

// Bystanders turn round — more of them the worse it was. The victim never
// reacts to themselves, and an NPC who was the victim does not comment on it.
function bystanders(zoneId, grade, name, victimIsNpc, victimId) {
  const pool = getZoneNpcs(zoneId).filter(n => !n._dead && !n._asleep && !(victimIsNpc && n.id === victimId));
  const n = Math.min(grade.reactors, pool.length);
  const chosen = [];
  const bag = [...pool];
  for (let i = 0; i < n; i++) chosen.push(...bag.splice(Math.floor(Math.random() * bag.length), 1));
  chosen.forEach((npc, i) => {
    const line = pick(grade.npc).replace(/\{name\}/g, name);
    setTimeout(() => sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} ${line}` }), 600 + i * 900);
  });
  return chosen.length;
}

export async function cmdSoil(args, raw, player) {
  if (!['admin', 'dev'].includes(player.role)) {
    return { type: 'error', message: 'Unknown command: ".soil".' };
  }
  const needle = (args || []).join(' ').trim().toLowerCase();
  if (!needle) {
    return { type: 'error', message: 'Usage: <span class="text-dim">soil &lt;player or npc&gt;</span> — they won\'t enjoy it.' };
  }

  const found = resolveTarget(player, needle);
  if (found.ambiguous) {
    return { type: 'error', message: `That matches ${found.ambiguous.length}: ${found.ambiguous.join(', ')}. Be more specific.` };
  }
  if (!found.hit) {
    return { type: 'error', message: `No player or NPC here (or online) called "${needle}".` };
  }

  const { being, isNpc } = found.hit;
  const name = being.handle || being.name;
  const zoneId = isNpc ? (being.current_zone || player.current_zone) : being.current_zone;
  const grade = rollGrade();

  // The mark. An NPC has nowhere to carry one (see the header) — the floor and
  // the air still get theirs, which is what makes the room's reaction earned.
  let clothed = false;
  if (!isNpc) clothed = await markPlayer(being);
  stainZone(zoneId, 'feces');
  if (grade.key === 'catastrophic') stainZone(zoneId, 'feces');
  taintAir(zoneId, 'fart');

  // The room, then the victim, then the noise, then the audience.
  const roomLine = pick(grade.room).replace(/\{name\}/g, name);
  sendToZone(zoneId, { type: 'zone_event', message: roomLine }, isNpc ? null : being.id);
  if (!isNpc) {
    sendToPlayer(being.id, {
      type: 'output',
      message: `<span style="color:var(--red)">${pick(grade.self)}</span>`
        + (clothed ? ` <span class="text-dim">Your clothes take what they can.</span>` : ''),
    });
  }
  soundOff(zoneId, isNpc ? null : being.id, grade);
  const reacted = bystanders(zoneId, grade, name, isNpc, being.id);

  return {
    type: 'output',
    message: `The Architect reaches into ${name} and lets go. `
      + `<span class="text-dim">(${grade.key}${isNpc ? ', npc — no lasting stain' : clothed ? ', soaked into their clothing' : ', on bare skin'}`
      + `; ${reacted} bystander${reacted === 1 ? '' : 's'} reacted)</span>`,
  };
}
