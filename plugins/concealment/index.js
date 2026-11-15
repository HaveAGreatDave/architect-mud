/**
 * concealment plugin — furniture that hides other furniture behind a passcode.
 *
 * The shape of it: TWO furniture rows in the same zone. One is the innocent piece
 * everybody sees (a drinks credenza, a bookcase, a wardrobe); the other is the
 * thing you don't want found (a chem lab), authored with `flags.concealed: true`
 * so the engine's own room-description filter leaves it out of the room entirely
 * (`commands/describe.js` — same filter a planted spy camera uses). Punch the code
 * into the innocent piece and its face pivots on a turntable, bringing the hidden
 * piece into the room; punch it again and the wall closes.
 *
 * Authoring — on the DISGUISE piece:
 *   flags.conceal_hides       = 'furn_chem_lab'   (id of the hidden piece, same zone)
 *   flags.conceal_code        = '1234'            (factory code; changeable in-game)
 *   flags.conceal_brand       = 'Cachet Vantage 900'  (optional, for the keypad chrome)
 * …and on the HIDDEN piece: flags.concealed = true.
 *
 * WHAT'S PRIVATE AND WHAT ISN'T — the whole point of the feature:
 *   - The keypad, the digits, a wrong code: private to the person at the panel.
 *     The digits never even reach the log (the client sends `concealcode` via
 *     sendCmdSilent), so a shoulder-surfing player sees nothing, and neither does
 *     a screen recording of the room.
 *   - The REVEAL is public. Anyone standing in the room watches the lab come out.
 *     That's deliberate: the secret is the code, not the furniture. Somebody who
 *     sees you open it knows what you are, they just can't do it themselves.
 *
 * State lives in the furniture row's own `flags.concealed`, written through
 * world.js's `updateFurniture` funnel — so the cache, the room description, the
 * `Furniture:` links and the synthesis plugin's lab lookup all agree with no new
 * seam, and a lab you left open is still open after a restart. Low-frequency
 * writes (a player at a keypad), never a tick.
 */
import { getZone, getZoneFurniture, getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { zoneOwnerId } from '../../server/engine/zone-filth.js';
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { escAttr } from '../../server/engine/text.js';
import { query } from '../../server/models/db.js';

const CODE_RE = /^\d{4,8}$/;
const FACTORY_CODE = '1234';

// THE CODE. The authored `flags.conceal_code` is only the factory code: a content deploy
// rewrites a furniture row's flags, so a code kept there went back to 1234 on every push.
// The code somebody sets lives in `conceal_codes`, one row per cabinet, and no row means
// the cabinet is still on its factory code. Read once per cabinet and kept here (a keypad
// is a few taps a day, never a tick); every write goes through saveCode, so this agrees
// with the table.
const factoryOf = (disguise) => String(disguise?.flags?.conceal_code || FACTORY_CODE);
const stored = new Map();   // furniture id -> the code somebody set, or null while it's factory

// { code, factory } or null when the table can't be read. Null fails shut: a cabinet
// whose own code can't be read must not fall back to opening for 1234.
async function codeState(disguise) {
  if (!stored.has(disguise.id)) {
    try {
      const { rows } = await query('SELECT code FROM conceal_codes WHERE furniture_id = $1', [disguise.id]);
      stored.set(disguise.id, rows[0]?.code || null);
    } catch (e) {
      console.warn('[concealment] reading a code failed:', e.message);
      return null;
    }
  }
  const own = stored.get(disguise.id);
  return own ? { code: own, factory: false } : { code: factoryOf(disguise), factory: true };
}
const codeOf = async (disguise) => (await codeState(disguise))?.code ?? null;

async function saveCode(disguise, code, player) {
  await query(
    `INSERT INTO conceal_codes (furniture_id, code, set_by, set_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (furniture_id) DO UPDATE SET code = EXCLUDED.code, set_by = EXCLUDED.set_by, set_at = now()`,
    [disguise.id, code, player?.id != null ? String(player.id) : null]);
  stored.set(disguise.id, code);
}

// Who may set a code: in a room somebody owns, the owner; in unowned space, whoever
// knows the current one. A guest with the code can still work the wall (the verb was
// never owner-locked), but can't change the code and lock the owner out of their flat.
function canSetCode(disguise, player) {
  const owner = zoneOwnerId(disguise?.zone_id);
  return !owner || (!!player && String(player.id) === String(owner));
}

const DARK = { type: 'error', message: "The keypad's dark. Try it again in a minute." };
const RED = { type: 'error', message: 'The keypad flashes red once and forgets you were there.' };
const brandOf = (disguise) => disguise?.flags?.conceal_brand || disguise?.name || 'the cabinet';

// Every disguise piece in a zone. Read from the world cache (getZoneFurniture),
// never queried — this runs off examine and off a keypad tap.
function disguisesIn(zoneId) {
  return getZoneFurniture(zoneId).filter((f) => f.flags?.conceal_hides);
}

// The disguise that hides a given piece, if any. The reverse of conceal_hides,
// derived from the same zone read — so a revealed lab needs no back-pointer to be
// resolvable, and a mis-authored one can't strand a keypad.
function disguiseHiding(furniture) {
  if (!furniture) return null;
  return disguisesIn(furniture.zone_id).find((d) => d.flags.conceal_hides === furniture.id) || null;
}

// The disguise piece a player means. A name hint matches the disguise itself, its
// brand, OR — once it's open and the cabinet has stood aside — the revealed piece
// standing in its place, because that's the only thing left in the room to name.
// With no hint, the only disguise in the room (ambiguity is refused rather than
// guessed, because guessing wrong here types your code at the wrong box).
function resolveDisguise(player, hint) {
  const all = disguisesIn(player.current_zone);
  if (!all.length) return { error: 'Nothing here has a keypad.' };
  const h = (hint || '').trim().toLowerCase();
  if (!h) {
    if (all.length > 1) return { error: `Which one? ${all.map((f) => f.name).join(', ')}.` };
    return { furniture: all[0] };
  }
  const hit = all.find((f) => {
    if (f.name.toLowerCase().includes(h)) return true;
    if (String(f.flags.conceal_brand || '').toLowerCase().includes(h)) return true;
    const hidden = getFurnitureById(f.flags.conceal_hides);
    return !!hidden && !hidden.flags?.concealed && hidden.name.toLowerCase().includes(h);
  });
  return hit ? { furniture: hit } : { error: `There's no keypad on "${hint}".` };
}

// Should this viewer even be TOLD there's a keypad? In a room somebody owns —
// your flat, your shop — the panel is the owner's business, so a guest sees a
// very expensive cabinet and nothing else. In unowned space (a squatted basement,
// a back room nobody holds the deed to) it reads as before, because there's no
// owner for it to be private FROM.
//
// This hides the ADVERT, never the verb: someone who knows the cabinet is there
// can still type `keypad` at it and still needs the code. The secret stays the
// code; this just stops the room description handing out the first half of it.
function keypadVisibleTo(disguise, viewer) {
  const owner = zoneOwnerId(disguise?.zone_id);
  if (!owner) return true;
  return !!viewer && String(viewer.id) === String(owner);
}

const isOpen = (disguise) => {
  const hidden = getFurnitureById(disguise.flags.conceal_hides);
  return !!hidden && !hidden.flags?.concealed;
};

// Swing the hidden piece in or out. `concealed` is the engine's own visibility
// flag, so flipping it is the entire mechanism — nothing else needs telling.
async function setConcealed(disguise, concealed) {
  const hidden = getFurnitureById(disguise.flags.conceal_hides);
  if (!hidden) return null;
  const flags = { ...(hidden.flags || {}) };
  if (concealed) flags.concealed = true; else delete flags.concealed;
  await updateFurniture(hidden.id, { flags: JSON.stringify(flags) });
  // the Room Stage turns the cabinet round for whoever has it open
  emit('furniture.changed', { zoneId: disguise.zone_id, id: disguise.id });
  return hidden;
}

// ── keypad <thing> [code] ────────────────────────────────────────────────────
// Bare: pops the client keypad (private). With a code typed inline: the text
// path, for anyone playing without the overlay — and the path regress drives.
async function cmdKeypad(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: "You're nowhere." };

  // Trailing all-digits words are codes, not part of the name: one is the code,
  // two are the current code and a new one (`keypad cabinet 1234 5678`).
  const words = args.filter(Boolean);
  const codes = [];
  while (words.length && codes.length < 2 && CODE_RE.test(words[words.length - 1])) codes.unshift(words.pop());
  const { furniture: disguise, error } = resolveDisguise(player, words.join(' '));
  // No keypad in this room at all — fall through so any other plugin's `keypad`
  // (or the unknown-command reply) gets its turn.
  if (!disguise) return codes.length ? { type: 'error', message: error } : undefined;

  if (!codes.length) {
    // The `log` rung gets no overlay, so it is told the typed form instead.
    if (await prefersLoggedPanelsOrDefault(player)) {
      return { type: 'output', message: `<span class="msg-system">A slim keypad wakes under your fingers. Type <b>keypad ${escAttr(disguise.name)} &lt;code&gt;</b> to enter the code, or <b>keypad ${escAttr(disguise.name)} &lt;code&gt; &lt;new code&gt;</b> to change it.</span>` };
    }
    return padMsg(disguise, 'enter', `<span class="msg-system">A slim keypad wakes under your fingers.</span>`);
  }
  if (codes.length === 2) return await setCode(disguise, codes[0], codes[1], player);
  return await submitCode(disguise, codes[0], player, { typed: true });
}

// The overlay, at one of its three stages: `enter` (the code, to open or seal),
// `setup` (a right factory code: pick your own before it opens) and `new` (the reset
// key's second step, after the current code checked out). The SERVER picks the stage;
// the pad only asks for what it's told to, so nothing in the client decides a code.
function padMsg(disguise, stage, message) {
  return {
    type: 'conceal_keypad',
    furnitureId: disguise.id,
    name: disguise.name,
    brand: brandOf(disguise),
    open: isOpen(disguise),
    stage,
    ...(message ? { message } : {}),
  };
}

// The one place a code is checked to work the wall. Both the overlay and the typed
// path land here.
async function submitCode(disguise, typed, player, { typed: fromText = false } = {}) {
  const state = await codeState(disguise);
  if (!state) return DARK;
  // Quiet failure, and quiet ON PURPOSE: the room learns nothing, so a failed
  // guess doesn't advertise that the cabinet is worth guessing at.
  if (typed !== state.code) return RED;
  // Still on the factory code: the first right entry asks for a code of your own,
  // and the wall doesn't move until there is one. A guest in somebody's flat can't
  // set it, so for them the factory code works the wall as it always did.
  if (state.factory && canSetCode(disguise, player)) {
    if (fromText) {
      return { type: 'output', message: `<span class="msg-system">${brandOf(disguise)}: factory code. Set your own before it opens: <b>keypad ${escAttr(disguise.name)} ${escAttr(typed)} &lt;new code&gt;</b>.</span>` };
    }
    return padMsg(disguise, 'setup');
  }
  return await toggle(disguise, player);
}

// Turn the wall: the hidden piece out if it's in, back in if it's out.
async function toggle(disguise, player) {
  const opening = !isOpen(disguise);
  const hidden = await setConcealed(disguise, !opening);
  if (!hidden) return { type: 'error', message: 'The keypad accepts the code. Nothing happens. Somebody has taken the mechanism.' };

  const brand = brandOf(disguise);
  const roomLine = opening
    ? `<span class="msg-system">The ${disguise.name} chimes softly and folds itself away on a hidden turntable: shelving, facing and all of it swallowed into the wall, ${hidden.name} rolling out into the space where it stood.</span>`
    : `<span class="msg-system">The ${hidden.name} rolls back into the wall, and the ${disguise.name} turns out of it to take its place. Just a cabinet again.</span>`;
  sendToZone(player.current_zone, { type: 'zone_event', message: roomLine, refresh: true }, player.id);
  // The actor's own room pane has to repaint too — the furniture list just gained
  // (or lost) a row. A message-less zone_event is the client's refresh-only shape.
  sendToPlayer(player.id, { type: 'zone_event', refresh: true });

  return {
    type: 'output',
    message: `<span class="msg-system">${brand}: <b>${opening ? 'OPEN' : 'SEALED'}</b>.</span>\n${roomLine}`,
  };
}

// The overlay's submit. Silent on the wire (sendCmdSilent), so the digits never
// appear in the player's own log either.
async function cmdConcealCode(args, raw, player) {
  const [furnId, typed] = args;
  const disguise = disguisesIn(player.current_zone).find((f) => f.id === furnId);
  if (!disguise) return { type: 'error', message: "You're not standing at that keypad any more." };
  if (!CODE_RE.test(String(typed || ''))) return { type: 'error', message: 'The keypad wants four to eight digits.' };
  return await submitCode(disguise, String(typed), player);
}

// The reset key, and the factory code's first entry. Prove you know the current code,
// standing at the thing, before you set a new one.
//   concealsetcode <id> <current>        checks it, and if it's right, asks for a new one
//   concealsetcode <id> <current> <new>  sets it
async function cmdConcealSetCode(args, raw, player) {
  const [furnId, oldCode, newCode] = args;
  const disguise = disguisesIn(player.current_zone).find((f) => f.id === furnId);
  if (!disguise) return { type: 'error', message: "You're not standing at that keypad any more." };
  if (newCode === undefined) {
    const state = await codeState(disguise);
    if (!state) return DARK;
    if (String(oldCode) !== state.code) return RED;
    if (!canSetCode(disguise, player)) return { type: 'error', message: 'Only the owner can change this code.' };
    return padMsg(disguise, 'new');
  }
  return await setCode(disguise, String(oldCode), String(newCode), player);
}

// The one place a code is set. A cabinet still on its factory code opens once it has
// one of its own, because that's what its owner came to it to do.
async function setCode(disguise, oldCode, newCode, player) {
  const state = await codeState(disguise);
  if (!state) return DARK;
  if (oldCode !== state.code) return RED;
  if (!canSetCode(disguise, player)) return { type: 'error', message: 'Only the owner can change this code.' };
  if (!CODE_RE.test(newCode)) return { type: 'error', message: 'A new code is four to eight digits.' };
  if (newCode === factoryOf(disguise)) return { type: 'error', message: "That's the factory code. Pick another." };
  try {
    await saveCode(disguise, newCode, player);
  } catch (e) {
    console.warn('[concealment] saving a code failed:', e.message);
    return { type: 'error', message: "The keypad won't take a new code right now. The old one still works." };
  }
  const set = `<span class="msg-system">${brandOf(disguise)}: new code set. Don't write it down.</span>`;
  if (!state.factory) return { type: 'output', message: set };
  const opened = await toggle(disguise, player);
  return opened.type === 'output' ? { type: 'output', message: `${set}\n${opened.message}` } : opened;
}

// furniture.describe — the disguise reads as what it pretends to be, plus a hint
// that there IS a panel (a keypad on a luxury cabinet isn't a secret; the code
// is). An open cabinet says so, because the room can plainly see it.
function keypadLine(target, trim) {
  return `\n<span class="text-dim">${trim}: <span class="action-link" data-action="keypad" data-target="${target.name.toLowerCase()}">keypad</span>.</span>`;
}

function describeFurniture(furniture, player) {
  const hides = furniture?.flags?.conceal_hides;
  // undefined, NOT '' — fireHook keeps the LAST defined return, so an empty string
  // here silently wipes whatever another plugin's furniture.describe contributed
  // (it ate the appliances plugin's "unplugged" line the first time round).
  if (hides) {
    // An OPEN cabinet isn't in the room at all any more (describe.js stands the
    // revealed piece in its place), so there's nothing left to annotate. Anyone
    // who examines it by name is looking at a slab folded into the wall.
    if (isOpen(furniture)) {
      const hidden = getFurnitureById(hides);
      return `\n<span class="text-dim">It's folded away into the wall cavity, ${hidden ? hidden.name : 'the compartment'} standing where it was.</span>`;
    }
    if (!keypadVisibleTo(furniture, player)) return undefined;
    return keypadLine(furniture, 'A slim keypad sits flush in the trim');
  }
  // The keypad follows the mechanism — with the cabinet gone, the panel that shuts
  // it again is on the revealed piece — but it is NOT advertised from here. This
  // hook is last-writer-wins (see above) and the revealed piece is usually a
  // crafting station whose own plugin describes it: synthesis' "Lab:" line landed
  // after this one and ate it. The keypad reaches the revealed piece through the
  // specializedActions row below instead, which drains into examine's Actions line
  // and the smart bar, and which nothing can overwrite.
  return undefined;
}

// requiredFlag makes `keypad` advertise itself on exactly the pieces that have
// one (examine's Actions row, and the mobile smart bar), and nowhere else;
// visibleFor narrows that again to the owner of an owned room, so the two
// discovery surfaces agree with the describe hook above.
// The second row is the same verb on the other half of the pair: a revealed piece
// carries `flags.conceal_hidden_by` purely so examine's Actions row and the smart
// bar can advertise `keypad` on the thing standing in the room once the cabinet
// has folded away. Discovery only — resolution derives the pair from the zone
// (disguiseHiding), so a stale or missing back-pointer costs a hint, never access.
// Only ONE row may carry a handler, or a bare `keypad` would run cmdKeypad twice.
export const specializedActions = [
  { verb: 'keypad', requiredFlag: 'conceal_hides', visibleFor: keypadVisibleTo, handler: cmdKeypad },
  { verb: 'keypad', requiredFlag: 'conceal_hidden_by', visibleFor: (f, v) => !f?.flags?.concealed && keypadVisibleTo(f, v), handler: null },
];

// A hard `search` of a room can notice that a wall is lying, WITHOUT giving up
// anything that matters. You learn a disguise piece is a disguise piece; you do
// not learn the code, and you do not learn what's behind it — those are the
// secret, and they stay behind the keypad exactly as before. (Examine already
// surfaces the keypad to anyone allowed to use it; this is for everybody else,
// and it is deliberately just a bad feeling.) Low priority so a genuinely
// findable THING in the room beats a hunch about the panelling.
function searchForSeams({ zoneId, margin }) {
  if (margin < 6) return null;
  const disguise = disguisesIn(zoneId).find((d) => !isOpen(d));
  if (!disguise) return null;
  return {
    found: true,
    priority: 200,
    message: `There's a seam in the panelling that isn't a seam. ${disguise.name} isn't as deep as the wall behind it.`,
  };
}

export const hooks = {
  'furniture.describe': describeFurniture,
  'search.provider': searchForSeams,
};

export const commands = {
  keypad: cmdKeypad,
  concealcode: cmdConcealCode,
  concealsetcode: cmdConcealSetCode,
};

// For regress: put a cabinet's code back how the suite found it (null = factory).
async function restoreCode(disguise, code) {
  if (code) { await saveCode(disguise, code, null); return; }
  await query('DELETE FROM conceal_codes WHERE furniture_id = $1', [disguise.id]);
  stored.set(disguise.id, null);
}
const ownCode = async (disguise) => { const s = await codeState(disguise); return s && !s.factory ? s.code : null; };

export const _test = { resolveDisguise, isOpen, submitCode, codeOf, codeState, canSetCode, ownCode, restoreCode, factoryOf };

console.log('[concealment] Plugin loaded.');
