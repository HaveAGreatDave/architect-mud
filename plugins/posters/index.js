/**
 * Posters plugin — the Freedom City "hero posters" are portable, and two of
 * them share a secret.
 *
 * A hung poster is a furniture row (object_type 'decoration') tagged
 * flags.hero_poster=true / flags.poster_key=<key>. `takedown` peels one off the
 * wall — deleting the furniture row and handing the player a rolled-up poster
 * item (item_poster_<key>) whose custom_data snapshots the wall text so the
 * exact poster survives the move. `putup` unrolls a carried poster onto the wall
 * of a home the player owns (gated on playerControlsApt — you can strip a poster
 * from any public wall, but you can only re-hang it in your own apartment). Only
 * one instance of each poster exists, so taking one bare-strips it from town;
 * re-hanging it mints a player-owned row with a fresh id, and the authored row
 * stays gone across content imports (a poster_taken:<key> world flag). This mirrors the generator plugin's pack/deploy pattern.
 *
 * The prose lives in the DB (furniture rows / item custom_data), not here — the
 * only content this file owns is the tiny mechanical fact of which two posters
 * line up, and the seam reveal itself.
 *
 * Easter egg, in two layers. The Kiyo and Cyd posters were printed as one
 * image: hang both in a room and examining either reveals — via the
 * furniture.describe hook — a hidden GRU where their torn edges meet. That's
 * the hint. The payoff is that all seven sheets came off one print run, and
 * hanging the complete set in a single room spells HELLMOO across the seams.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getApartment, insertFurniture, updateFurniture, deleteFurniture, deleteFurnitureWhere, getZoneFurniture } from '../../server/engine/world.js';
import { setFlag, getWorldFlagsByPrefix } from '../../server/engine/flags.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { escAttr } from '../../server/engine/text.js';
import { emit } from '../../server/engine/events.js';
import { isStaff } from '../admin/index.js';
// The wall order and the word it spells, and how ROOM draws each sheet (sheets.js, a leaf the Room Lab imports too)
import { MURAL, MURAL_WORD, roomSheets, spotOf, carriedSheet } from './sheets.js';

// Posters that share a secret seam. Deliberately tiny and mechanical.
const SECRET_PAIR = { kiyo: 'cyd', cyd: 'kiyo' };

const muralSlot = (key) => MURAL.indexOf(key);          // 0-based, -1 if not in the mural
const titleName = (key) => key.charAt(0).toUpperCase() + key.slice(1);

// What each of them was actually remembered for. One clause apiece, keyed to
// the poster it belongs to — the roll-call below is rendered from MURAL order,
// so this can never drift out of step with the wall.
const HIJINKS = {
  djerk: `who said it once, and watched the whole city catch it`,
  alphagunman: `who never fired first, and never once had to fire second`,
  ocelot: `whom nobody could ever quite prove they had seen, which was the entire point of Ocelot`,
  cyd: `who put a wing down in whatever was left of the street, every single time, and never once asked what you had done to deserve the ride`,
  kiyo: `who never once looked up, not even when it got close, because whatever was in his hands was more interesting than whatever was coming, and everything you were holding, he made`,
  stabbz: `cutting only what needed cutting, and holding sole private custody of the word "needs"`,
  bonghitz: `up on the bar swearing blind that the smoke spelled PEACE, still owing everybody forty credits`,
};

// Wall titles read "hero poster: NAME, EPITHET"; strip the boilerplate for prose.
function shortName(name) {
  return String(name || 'poster').replace(/^hero poster:\s*/i, '');
}

// The seam reveal, shown on examine when a poster's secret partner hangs in the
// same room. `partnerName` is the partner furniture's wall title.
function seamReveal(partnerName) {
  const other = shortName(partnerName).split(',')[0].trim();
  return `<span class="text-dim">Step back, and you notice this poster lines up seam-to-seam with the ${other} poster beside it: the two were printed as a single sheet, then torn apart. The wing cut off at the edge of the one frame runs on unbroken over the other man's head, which is why it was never explained: it was never his wing. And where the ragged edges meet, the shadow under it and the scorch resolve into three deliberate letters that neither poster shows alone: <b>G R U</b>. Someone wanted these two hung together. Only together.</span>`;
}

// The full-wall payoff — only ever shown when all seven sheets hang together.
// Supersedes the GRU pair hint, which is one seam of the seven described here.
function muralReveal() {
  // The roll-call is rendered off MURAL so it can't drift out of order. The
  // leftmost sheet is rotated to the end — he's the one who started the word,
  // so he closes the list.
  const order = [...MURAL.slice(1), MURAL[0]];
  const roll = order.map(k => `${titleName(k)}, ${HIJINKS[k]}.`).join('\n');
  return `<span class="text-dim mural-reveal">Step back, and the wall goes quiet.
The seams are the first thing to go. Seven torn edges you could have laid a fingernail into a moment ago, and now you can't find one of them; the paper closes over itself the way water closes, and what hung there as seven posters hangs there as a single unbroken sheet that no press left standing in this city is big enough to have printed.
Then the word comes up out of it. Not painted, not stencilled, surfacing, the way a name surfaces in a language you spoke as a child, letters standing where the seams were and gathering a low gleam off no light that's in this room:
<span class="mural-word">${MURAL_WORD.split('').join(' ')}</span>
That's what we called it. That's what this place was called, before somebody put the word Freedom on a sign and everyone was too polite to argue.
God, that city. Downtown so thick with police cameras you could be robbed politely, and everybody agreeing that this counted as law. Cheney Way at four in the morning, lit up like a showroom, not one thing open. Drinking in Heaven, which was not. Drinking in the Wide Stance when Heaven threw you out, and in the Round Corner when the Wide Stance did, the barman there already pouring before you were through the door because there was only ever the one place left to go. Getting lost two hours in the Sharpton Projects on a floor you had walked a hundred times, coming out somewhere you had never been, holding something you hadn't gone in for. Parking anywhere at all, and learning some days later that it was at Dope Jack's, in pieces, and being told to your face that the pieces were an improvement.
The wind coming off the ocean to the north with a taste in it that a hundred years hadn't fixed. The river going out east, brown as stewed tea. Somebody forever about to make their fortune up in CorpClave. Somebody forever walking out into the waste with a rifle and two days of water, coming back with neither, swearing it had been worth it. Everybody swearing blind they were done with all of it and moving out to Slagtown where no camera could see them and no patrol would come, and nobody, not once, ever moving to Slagtown. Getting shot on a Tuesday and being back on the same stool by Wednesday telling it wrong, then telling it better, then telling it so much better that the man who shot you would wander over to complain about the accuracy.
And all of them were here.
${roll}
Good years. Loud, stupid, badly-lit years, and every single one of us swore we were only passing through.
You'd go back tomorrow. You know you would.
It hangs on your wall now, gleaming, and you stand in front of it a good while longer than you meant to.</span>`;
}

// The seam refusing to stay a seam — one per sheet so hanging the whole run
// doesn't repeat itself. The pair (Kiyo/Cyd) never see these; they keep the
// understated wink that sets up the GRU reveal.
const SEAM_GOES = [
  `and the seam goes: torn edge meets torn edge and simply stops being an edge, the way a crack closes in ice.`,
  `and the join disappears under your thumb. You go back looking for it and there isn't one.`,
  `and where the two edges meet there's abruptly nothing to meet; the tear closes and won't be found again.`,
  `and the seam vanishes so cleanly that you turn the corner of the paper back to check, and find it whole.`,
  `and the tear seals itself out of existence. Run a nail down where it was and the nail finds flat paper.`,
];

// Where a freshly-hung sheet falls in the run, and whether its edges found their
// answer. Drives the `putup` placement report — the wall assembles in order.
function placementLine(key, present) {
  const slot = muralSlot(key);
  if (slot < 0) return '';
  const here = MURAL.filter(k => present.has(k));
  const left = MURAL[slot - 1], right = MURAL[slot + 1];
  const neighbours = [left, right].filter(k => k && present.has(k)).map(titleName);

  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  const seat = slot === 0
    ? `Its clean factory margin sits outermost; every other edge is torn.`
    : slot === MURAL.length - 1
      ? `It wants to hang at the far end of the run.`
      : `It wants to hang ${ORDINAL[slot]} along the run.`;

  // The secret pair keep their own understated wink — they are the hint, and
  // saying too much here would give the seam away before the examine does.
  // Every other sheet gets the plain truth: the seam stops existing.
  let edges;
  if (!neighbours.length) {
    edges = ` Nothing beside it answers the tearing yet.`;
  } else if (SECRET_PAIR[key] && present.has(SECRET_PAIR[key])) {
    edges = ` It settles oddly close to the poster already hanging here: the torn edges almost seem to line up.`;
  } else {
    const who = neighbours.length > 1
      ? `the ${neighbours[0]} and ${neighbours[1]} sheets`
      : `the ${neighbours[0]} sheet`;
    // Keyed by slot rather than random so hanging the run reads as a sequence
    // instead of the same sentence five times.
    edges = ` You smooth it down against ${who} ${SEAM_GOES[slot % SEAM_GOES.length]}`
      + (neighbours.length > 1
        ? ` It sits as though none of them had ever been apart.`
        : ` It sits as though the two had never been apart.`);
  }
  return ` <span class="text-dim">${seat}${edges} <b>${here.length} of ${MURAL.length}</b> sheets hang here.</span>`;
}

// Hero posters hanging on the wall of a zone, optionally name-filtered.
// Off the in-memory room furniture — a hung poster is furniture in a room.
const isHeroPoster = (f) =>
  f.object_type === 'decoration' && String(f.flags?.hero_poster) === 'true';

function findPosters(target, zone) {
  const needle = target ? String(target).toLowerCase() : null;
  return getZoneFurniture(zone).filter(f =>
    isHeroPoster(f) && (!needle || (f.name || '').toLowerCase().includes(needle)));
}

// Set of poster keys currently hanging in a zone. One round trip, not seven.
function hangingKeys(zone) {
  return new Set(getZoneFurniture(zone)
    .filter(f => String(f.flags?.hero_poster) === 'true')
    .map(f => f.flags?.poster_key).filter(Boolean));
}

// Provenance. Authored posters are content rows with files under
// content/furniture/; a re-hung poster is a player row with a furn_<8hex> id,
// the shape the export and the import's deletion pass both skip. Never reuse an
// authored id for a player row: the import's upsert would move it back.
const TAKEN_PREFIX = 'poster_taken:';
const isAuthoredPoster = (f) => f.origin !== 'player' && !/^furn_[0-9a-f]{8}$/.test(String(f.id));

// Remove authored posters somebody has taken down. Runs once when the plugin
// loads (after the world, so the furniture cache is warm); exported for regress.
export async function reconcileTakenPosters() {
  const keys = (await getWorldFlagsByPrefix(TAKEN_PREFIX)).map(([k]) => k.slice(TAKEN_PREFIX.length));
  if (!keys.length) return [];
  return deleteFurnitureWhere(
    `DELETE FROM furniture WHERE origin='authored' AND flags->>'hero_poster'='true' AND flags->>'poster_key' = ANY($1)`,
    [keys]);
}

// Peel one resolved poster furniture row off the wall into a carried rolled item.
async function peelPoster(f, player, broadcast) {
  const key = f.flags?.poster_key;
  if (!key) return { type: 'error', message: `That won't come off the wall.` };

  // An authored poster's row comes back on every content import (its file is
  // still in git), so record that it's been taken; reconcileTakenPosters()
  // removes it again when the plugin loads after the deploy restart.
  if (isAuthoredPoster(f)) await setFlag('world', `${TAKEN_PREFIX}${key}`, 'true');
  await deleteFurniture(f.id);
  emit('room.sheetsChanged', { zoneId: f.zone_id });
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data) VALUES ($1,$2,$3,1,$4)`,
    [randomUUID(), player.id, `item_poster_${key}`,
     JSON.stringify({ poster_key: key, name: f.name, description: f.description })]
  );

  broadcast(player.current_zone,
    { type: 'zone_event', message: `${player.handle} peels the ${shortName(f.name)} poster off the wall and rolls it up.` },
    player.id);
  return { type: 'take', message: `You peel ${f.name} off the wall and roll it into a tube. <span class="text-dim">(Hang it elsewhere with \`putup\`.)</span>` };
}

// ── takedown <poster> — peel a hero poster off the wall into a rolled item ────
async function cmdTakedown(args, raw, player, broadcast) {
  const target = args.join(' ').replace(/^(the|down)\s+/i, '').trim();
  const rows = findPosters(target, player.current_zone);
  if (!rows.length)
    return { type: 'error', message: target
      ? `There's no "${target}" poster on the wall here.`
      : `There's no poster here to take down.` };
  if (rows.length > 1)
    return { type: 'error', message: `Which one? ${rows.map(r => `"${shortName(r.name)}"`).join(', ')}. Try \`takedown <name>\`.` };

  return peelPoster(rows[0], player, broadcast);
}

// ── take <poster> — the natural verb also peels a hanging poster, then falls ──
// through to the engine's ground-item take for anything that isn't one.
async function cmdTake(args, raw, player, broadcast) {
  const target = args.join(' ').replace(/^the\s+/i, '').trim().toLowerCase();
  // No target, "all", or "take X from Y" are the engine's job — let them fall through.
  if (!target || target === 'all' || target.includes(' from ')) return undefined;

  const rows = findPosters(target, player.current_zone);
  if (!rows.length) return undefined;               // not a poster → engine take
  if (rows.length > 1)
    return { type: 'error', message: `Which one? ${rows.map(r => `"${shortName(r.name)}"`).join(', ')}. Try \`take <name>\`.` };

  return peelPoster(rows[0], player, broadcast);
}

// ── putup <poster> — unroll a carried poster onto the current room's wall ─────
async function cmdPutup(args, raw, player, broadcast) {
  // Posters only go up on walls you own — your home. Anywhere else, no.
  if (!playerControlsApt(player, getApartment(player.current_zone)))
    return { type: 'error', message: `You can only hang posters in a home you own: these walls aren't yours. Take it back to your place and \`putup\` there.` };

  const { target, wall } = parsePutup(args);
  const rows = await carriedPosters(player.id);
  let carried = rows;
  if (target) {
    const t = target.toLowerCase();
    carried = rows.filter(r => (r.custom_data?.name || '').toLowerCase().includes(t));
  }
  if (!carried.length)
    return { type: 'error', message: target
      ? `You're not carrying a "${target}" poster.`
      : `You have no posters to put up.` };
  if (carried.length > 1)
    return { type: 'error', message: `Which one? ${carried.map(r => `"${shortName(r.custom_data?.name)}"`).join(', ')}. Try \`putup <name>\`.` };

  const { key, name } = await hangPoster(carried[0], player, player.current_zone, wall ? { wall } : null);
  broadcast(player.current_zone,
    { type: 'zone_event', message: `${player.handle} smooths the ${shortName(name)} poster onto ${wall ? WALL_NAME[wall] : 'the wall'}.` },
    player.id);

  // Placement report — where this sheet falls in the run, and which torn edges
  // it just answered. The wall tells you it's assembling long before it says why.
  const extra = placementLine(key, hangingKeys(player.current_zone));
  return { type: 'take', message: `You unroll ${name} and smooth it onto ${wall ? WALL_NAME[wall] : 'the wall'}.${extra}` };
}

// `putup kiyo on the left wall`: the wall is the last word (before an optional "wall"), as `arrange` reads it.
const WALLS = { left: 'left', right: 'right', front: 'front', back: 'back', window: 'front', door: 'back' };
const WALL_NAME = { left: 'the left wall', right: 'the right wall', front: 'the window wall', back: 'the door wall' };
function parsePutup(args) {
  const words = args.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  while (words.length && /^(the|up)$/.test(words[0])) words.shift();
  if (words.length && words.at(-1) === 'wall') words.pop();
  let wall = null;
  if (words.length && WALLS[words.at(-1)]) {
    wall = WALLS[words.pop()];
    while (words.length && /^(on|onto|to|against|by|at|the)$/.test(words.at(-1))) words.pop();
  }
  return { target: words.join(' ').trim(), wall };
}

// The rolled posters a player carries (loose, not in a bag). One query.
async function carriedPosters(playerId) {
  const { rows } = await query(
    `SELECT id, item_id, custom_data FROM player_inventory
      WHERE player_id=$1 AND container_id IS NULL AND item_id LIKE 'item_poster_%'`,
    [playerId]);
  return rows;
}

// Unroll one carried poster (an inventory row) onto a wall of `zoneId`. `spot` ({ wall, along? }) is where the run
// goes; the rest of the run already up in the room moves with it, so the sheets stay edge to edge. With no spot, the new
// sheet joins the run where it hangs.
async function hangPoster(r, player, zoneId, spot = null) {
  const cd = r.custom_data || {};
  const key = cd.poster_key || r.item_id.replace('item_poster_', '');
  const run = getZoneFurniture(zoneId).filter(isHeroPoster);
  const at = spot ? spotOf(spot) : spotOf(run.find((f) => spotOf(f.flags?.sheet_spot))?.flags?.sheet_spot);
  // A fresh player row, never the authored id (see isAuthoredPoster).
  await insertFurniture({
    id: `furn_${randomUUID().slice(0, 8)}`, zone_id: zoneId,
    // a sheet carried before custom_data held its words has neither; furniture.description is NOT NULL
    name: cd.name || `hero poster: ${key.toUpperCase()}`, description: cd.description || '', object_type: 'decoration',
    flags: JSON.stringify({ hero_poster: true, poster_key: key, ...(at ? { sheet_spot: at } : {}) }),
    origin: 'player', owner_id: player.id,
  });
  await query('DELETE FROM player_inventory WHERE id=$1', [r.id]);
  if (spot && at) await moveRun(run, at);
  // ROOM hangs it on the wall for whoever has the room open, and the seventh sheet plays the join
  emit('room.sheetsChanged', { zoneId });
  return { key, name: cd.name };
}

// Every sheet of the run to one spot (at most seven rows; a run that's already there isn't written).
async function moveRun(run, at) {
  const want = JSON.stringify(at);
  for (const f of run) {
    if (JSON.stringify(spotOf(f.flags?.sheet_spot)) === want) continue;
    await updateFurniture(f.id, { flags: JSON.stringify({ ...(f.flags || {}), sheet_spot: at }) });
  }
}

// ── posterkit — staff only: one rolled copy of every sheet in the run ─────────
// The wall text comes from whichever copy is hanging somewhere (RAM: the
// furniture cache); a sheet nobody has up gets its bare title.
async function cmdPosterkit(args, raw, player) {
  if (!isStaff(player)) return { type: 'error', message: 'Unknown command: "posterkit". Type HELP for commands.' };
  const hung = new Map();
  for (const zoneId of world.zones.keys())
    for (const f of getZoneFurniture(zoneId))
      if (String(f.flags?.hero_poster) === 'true' && f.flags?.poster_key && !hung.has(f.flags.poster_key))
        hung.set(f.flags.poster_key, f);
  const ids = [], items = [], datas = [];
  for (const key of MURAL) {
    const f = hung.get(key);
    ids.push(randomUUID()); items.push(`item_poster_${key}`);
    datas.push(JSON.stringify({ poster_key: key,
      name: f?.name || `hero poster: ${key.toUpperCase()}`, description: f?.description || '' }));
  }
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data)
     SELECT u.id, $1, u.item, 1, u.cd::jsonb FROM unnest($2::text[], $3::text[], $4::text[]) AS u(id, item, cd)`,
    [player.id, ids, items, datas]);
  return { type: 'take', message: `You get all ${MURAL.length} posters of the ${MURAL_WORD} run, rolled up. <span class="text-dim">(\`putup\` them in a home you own.)</span>` };
}

// ── furniture.describe hook — a "you can peel this off" telegraph, plus the ───
// Kiyo/Cyd seam reveal when the secret partner hangs in the same room.
export const hooks = {
  // The sheets ROOM hangs on this room's wall (plugins/roomstage sheetsOf). Sync and query-free: the
  // furniture cache is RAM.
  'room.sheets': (zoneId) => {
    const out = roomSheets(getZoneFurniture(zoneId));
    return out.length ? out : undefined;
  },
  // The arrange mode's Posters menu (plugins/roomstage `arrange sheets`): the posters this player carries, each as
  // the sheet it would hang as, keyed by its inventory row.
  'room.sheetStock': async (player) => {
    const out = [];
    for (const r of await carriedPosters(player.id)) {
      const key = r.custom_data?.poster_key || r.item_id.replace('item_poster_', '');
      const s = carriedSheet(key, r.custom_data?.name);
      if (s) out.push({ ...s, id: `inv:${r.id}`, inv: r.id, name: r.custom_data?.name || s.title });
    }
    return out.length ? out : undefined;
  },
  // The arrange mode's Save hanging a carried poster (plugins/roomstage arrangeLayout `sheet+<inv>@<spot>`).
  // Answers true when it hung, false when this player doesn't carry that roll.
  'room.sheetHang': async ({ player, zoneId, inv, spot }) => {
    const r = (await carriedPosters(player.id)).find((x) => x.id === inv);
    if (!r) return false;
    await hangPoster(r, player, zoneId, spot);
    return true;
  },
  'furniture.describe': async (f) => {
    if (f?.flags?.hero_poster !== true) return undefined;

    // Every hero poster tells you it comes off the wall — furniture doesn't
    // advertise this the way a loose item does, so say it plainly, with a
    // clickable `take` link (data-action/target -> auto-runs `take <name>`).
    const takeLink = `<span class="action-link" data-action="take" data-target="${escAttr(f.name)}" data-label="${escAttr(shortName(f.name))}" title="Peel this poster off the wall">take</span>`;
    let out = `<span class="text-dim">It's only wheat-pasted on: you could peel it down and roll it up. (${takeLink})</span>`;

    // The whole run hanging together supersedes the pair hint — GRU is one of
    // the seven seams the full reveal walks you along.
    const present = hangingKeys(f.zone_id);
    if (MURAL.every(k => present.has(k))) return `${out}\n${muralReveal()}`;

    const partner = SECRET_PAIR[f.flags.poster_key];
    if (partner && present.has(partner)) {
      const other = getZoneFurniture(f.zone_id).find(x =>
        String(x.flags?.hero_poster) === 'true' && x.flags?.poster_key === partner);
      if (other) out += `\n${seamReveal(other.name)}`;
    }
    return out;
  },
};

try { await reconcileTakenPosters(); }
catch (e) { console.warn(`  posters: reconcile of taken posters failed: ${e.message}`); }

export const commands = { takedown: cmdTakedown, take: cmdTake, putup: cmdPutup, posterkit: cmdPosterkit };

// Exposed for the regression suite only.
export const _test = { SECRET_PAIR, MURAL, MURAL_WORD, shortName, seamReveal, muralReveal, placementLine };
