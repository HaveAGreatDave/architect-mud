// `sysop rename <npc> to <new name>`: tell somebody in the room their new name.
// Writes the npcs row (every text column that carried the old full name, so their
// own description and lines follow), patches the live NPC, rewrites their content
// file on a local DB (syncEntityFile is a no-op on prod), and they take it in out loud.
import { query } from '../../server/models/db.js';
import { world, getZoneNpcs, syncNpc } from '../../server/engine/world.js';
import { npcSay } from '../../server/engine/npc-speech.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { syncEntityFile } from '../../server/api/content-sync.js';
import { logActivity } from '../../server/models/db.js';

// Stunned, then accepting. {name} is the new name.
const TAKE_IN = [
  `@!surprised "{name}? ...Huh. Yeah. Yeah, that's me. {name}."`,
  `@!surprised "Wait, what? {name}? ...Okay. {name}. Sure."`,
  `@!surprised "{name}. That sounds right, actually. Always has."`,
  `@!surprised "Hang on, I was... no. No, you're right. It's {name}."`,
];
const BEAT = [
  'blinks a few times, like somebody just woke them.',
  'stares at nothing for a second.',
  'opens their mouth, shuts it again.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const tidy = (s) => s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export async function renameNpc(player, words) {
  const raw = words.join(' ');
  const m = raw.match(/^(.+?)\s+(?:to|as|=)\s+(.+)$/i);
  if (!m) return { ok: false, error: 'Usage: <b>sysop rename &lt;npc&gt; to &lt;new name&gt;</b>' };
  const who = m[1].trim().toLowerCase();
  const name = tidy(m[2].replace(/^["']|["']$/g, ''));
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'A name is 2 to 60 characters.' };

  const here = getZoneNpcs(player.current_zone).filter(n => !n._dead);
  const npc = here.find(n => String(n.id).toLowerCase() === who)
    || here.find(n => n.name?.toLowerCase() === who)
    || here.find(n => n.name?.toLowerCase().includes(who));
  if (!npc) return { ok: false, error: `There's no "${m[1].trim()}" here.` };
  return renameNpcTo(player, npc, name);
}

// "Your name is X" in the dialogue box, for staff. Null when the line isn't a renaming.
const FILLER = String.raw`(?:(?:now|actually|officially|henceforth|from now on|from today)[,\s]+)*`;
const NAMING = new RegExp(String.raw`^\s*(?:(?:ok(?:ay)?|right|listen|hey)[,\s]+)?(?:from now on|from today|henceforth)?[,\s]*(?:` + [
  String.raw`your (?:new )?name(?:'s| is| will be| shall be| is going to be| is gonna be)`,
  String.raw`you(?:'re| are| will be| shall be)? (?:now )?(?:called|named|known as)`,
  String.raw`i(?:'m going to| will| shall|'ll)? ?(?:now )?(?:call|name|rename) you`,
].join('|') + String.raw`)\s+` + FILLER + String.raw`["']?(.+?)["']?[.!]*\s*$`, 'i');
export function namingIn(text) {
  const m = String(text || '').match(NAMING);
  return m ? tidy(m[1].replace(/^["']|["']$/g, '')) : null;
}

// inPanel: the dialogue box shows the answer itself, so hand the line back instead of sending it later.
export async function renameNpcTo(player, npc, name, { inPanel = false } = {}) {
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'A name is 2 to 60 characters.' };
  const old = npc.name;
  if (old === name) return { ok: false, error: `They're already ${name}.` };
  const clash = [...world.npcs.values()].find(n => n.id !== npc.id && n.name?.toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, error: `${clash.name} (${clash.id}) already has that name. Full names are unique.` };

  // Every column that mentions the old full name gets the new one.
  const { rows } = await query('SELECT * FROM npcs WHERE id=$1', [npc.id]);
  if (!rows.length) return { ok: false, error: `${npc.id} has no row.` };
  const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'g');
  const cols = { name };
  for (const [k, v] of Object.entries(rows[0])) {
    if (k === 'id' || k === 'name' || v == null) continue;
    if (typeof v === 'string' && v.includes(old)) cols[k] = v.replace(re, name);
    else if (typeof v === 'object' && !(v instanceof Date)) {
      const s = JSON.stringify(v);
      if (s.includes(old)) cols[k] = JSON.parse(s.replace(re, name.replace(/["\\]/g, '\\$&')));
    }
  }
  const keys = Object.keys(cols);
  await query(
    `UPDATE npcs SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${keys.length + 1}`,
    [...keys.map(k => (cols[k] !== null && typeof cols[k] === 'object' ? JSON.stringify(cols[k]) : cols[k])), npc.id],
  );
  syncNpc(npc.id, cols);
  try { await syncEntityFile('npcs', npc.id); } catch (e) { console.warn('[admin] rename file sync:', e.message); }
  logActivity('sysop_rename', npc.id, player.name, `${old} -> ${name}`);

  // The reaction: a beat, then the line.
  const zone = player.current_zone;
  const beat = pick(BEAT), line = pick(TAKE_IN).replaceAll('{name}', name);
  if (inPanel) return { ok: true, old, beat, line };
  sendToZone(zone, { type: 'zone_event', message: `${name} ${beat}` });
  setTimeout(() => {
    const live = world.npcs.get(npc.id);
    if (!live || !world.zones.get(zone)?.npcs?.has(npc.id)) return;
    sendToZone(zone, npcSay(live, line, { kind: 'dialogue' }));
  }, 1800);

  const changed = keys.filter(k => k !== 'name');
  return { ok: true, message: `${old} (${npc.id}) is now ${name}.${changed.length ? ` Also rewrote: ${changed.join(', ')}.` : ''} Content file updated on a local DB; commit it when you're happy.` };
}
