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
import { zoneOwnerId } from '../../server/engine/zone-filth.js';

const CODE_RE = /^\d{4,8}$/;
const FACTORY_CODE = '1234';

const codeOf = (disguise) => String(disguise?.flags?.conceal_code || FACTORY_CODE);
const brandOf = (disguise) => disguise?.flags?.conceal_brand || disguise?.name || 'the cabinet';

// Every disguise piece in a zone. Read from the world cache (getZoneFurniture),
// never queried — this runs off examine and off a keypad tap.
function disguisesIn(zoneId) {
  return getZoneFurniture(zoneId).filter((f) => f.flags?.conceal_hides);
}

// The disguise piece a player means. A name hint matches the disguise itself OR
// the brand; with no hint, the only disguise in the room (ambiguity is refused
// rather than guessed, because guessing wrong here types your code at the wrong
// box).
function resolveDisguise(player, hint) {
  const all = disguisesIn(player.current_zone);
  if (!all.length) return { error: 'Nothing here has a keypad.' };
  const h = (hint || '').trim().toLowerCase();
  if (!h) {
    if (all.length > 1) return { error: `Which one? ${all.map((f) => f.name).join(', ')}.` };
    return { furniture: all[0] };
  }
  const hit = all.find((f) => f.name.toLowerCase().includes(h) || String(f.flags.conceal_brand || '').toLowerCase().includes(h));
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
  return hidden;
}

// ── keypad <thing> [code] ────────────────────────────────────────────────────
// Bare: pops the client keypad (private). With a code typed inline: the text
// path, for anyone playing without the overlay — and the path regress drives.
async function cmdKeypad(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: "You're nowhere." };

  // A trailing all-digits word is the code, not part of the name.
  const words = args.filter(Boolean);
  const typed = words.length && CODE_RE.test(words[words.length - 1]) ? words.pop() : null;
  const { furniture: disguise, error } = resolveDisguise(player, words.join(' '));
  // No keypad in this room at all — fall through so any other plugin's `keypad`
  // (or the unknown-command reply) gets its turn.
  if (!disguise) return typed ? { type: 'error', message: error } : undefined;

  if (!typed) {
    return {
      type: 'conceal_keypad',
      furnitureId: disguise.id,
      name: disguise.name,
      brand: brandOf(disguise),
      open: isOpen(disguise),
      message: `<span class="msg-system">A slim keypad wakes under your fingers.</span>`,
    };
  }
  return await submitCode(disguise, typed, player);
}

// The one place a code is checked. Both the overlay and the typed path land here.
async function submitCode(disguise, typed, player) {
  if (typed !== codeOf(disguise)) {
    // Quiet failure, and quiet ON PURPOSE: the room learns nothing, so a failed
    // guess doesn't advertise that the cabinet is worth guessing at.
    return { type: 'error', message: 'The keypad flashes red once and forgets you were there.' };
  }

  const opening = !isOpen(disguise);
  const hidden = await setConcealed(disguise, !opening);
  if (!hidden) return { type: 'error', message: 'The keypad accepts the code. Nothing happens. Somebody has taken the mechanism.' };

  const brand = brandOf(disguise);
  const roomLine = opening
    ? `<span class="msg-system">The ${disguise.name} chimes softly, and its whole face pivots on a hidden turntable — shelving swinging away, ${hidden.name} rolling out of the wall behind it.</span>`
    : `<span class="msg-system">${hidden.name} rolls back into the wall, and the ${disguise.name} pivots shut over it. Just a cabinet again.</span>`;
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
  if (!CODE_RE.test(String(typed || ''))) return { type: 'error', message: 'The keypad wants four digits.' };
  return await submitCode(disguise, String(typed), player);
}

// Changing the code needs the cabinet OPEN — the same rule every real safe has:
// prove you know the old one, standing at the thing, before you set a new one.
async function cmdConcealSetCode(args, raw, player) {
  const [furnId, oldCode, newCode] = args;
  const disguise = disguisesIn(player.current_zone).find((f) => f.id === furnId);
  if (!disguise) return { type: 'error', message: "You're not standing at that keypad any more." };
  if (String(oldCode) !== codeOf(disguise)) return { type: 'error', message: 'The keypad flashes red once and forgets you were there.' };
  if (!CODE_RE.test(String(newCode || ''))) return { type: 'error', message: 'A new code is four to eight digits.' };
  const flags = { ...(disguise.flags || {}), conceal_code: String(newCode) };
  await updateFurniture(disguise.id, { flags: JSON.stringify(flags) });
  return { type: 'output', message: `<span class="msg-system">${brandOf(disguise)}: code changed. Don't write it down.</span>` };
}

// furniture.describe — the disguise reads as what it pretends to be, plus a hint
// that there IS a panel (a keypad on a luxury cabinet isn't a secret; the code
// is). An open cabinet says so, because the room can plainly see it.
function describeFurniture(furniture, player) {
  const hides = furniture?.flags?.conceal_hides;
  // undefined, NOT '' — fireHook keeps the LAST defined return, so an empty string
  // here silently wipes whatever another plugin's furniture.describe contributed
  // (it ate the appliances plugin's "unplugged" line the first time round).
  if (!hides) return undefined;
  if (isOpen(furniture)) {
    // Open is public whoever you are — the lab is standing in the room.
    const hidden = getFurnitureById(hides);
    return `\n<span class="text-dim">It stands pivoted open, ${hidden ? hidden.name : 'the compartment'} exposed behind it.</span>`;
  }
  if (!keypadVisibleTo(furniture, player)) return undefined;
  return `\n<span class="text-dim">A slim keypad sits flush in the trim — <span class="action-link" data-action="keypad" data-target="${furniture.name.toLowerCase()}">keypad</span>.</span>`;
}

// requiredFlag makes `keypad` advertise itself on exactly the pieces that have
// one (examine's Actions row, and the mobile smart bar), and nowhere else;
// visibleFor narrows that again to the owner of an owned room, so the two
// discovery surfaces agree with the describe hook above.
export const specializedActions = [
  { verb: 'keypad', requiredFlag: 'conceal_hides', visibleFor: keypadVisibleTo, handler: cmdKeypad },
];

export const hooks = {
  'furniture.describe': describeFurniture,
};

export const commands = {
  keypad: cmdKeypad,
  concealcode: cmdConcealCode,
  concealsetcode: cmdConcealSetCode,
};

export const _test = { resolveDisguise, isOpen, submitCode, codeOf };

console.log('[concealment] Plugin loaded.');
