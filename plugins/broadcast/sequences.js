// A SHOW'S 3-D SEGMENTS, ON AIR. A show row (client/shared/sequence.js) says which sequence plays at
// which moment of a broadcast. A broadcast calls `deskSegment` with the moment and the facts of the
// day, and gets back the lines to air and what a TV needs to draw them. See
// docs/proposals/broadcast-3d.md, "The first version".
//
// Sets, sequences and shows are media_graphics rows, so they're in graphicsCache at boot and cost
// nothing here. Nothing in this file knows a sport: a moment is a string (`open`, `break`, `close`)
// and the facts are whatever the caller has.
//
// Pure, with the cache and the NPC lookup passed in, so regress runs it with object literals.

import { parseDoc, timeline, slotFor, fill, castToken, resolveSet } from '../../client/shared/sequence.js';

const parsed = new WeakMap();   // a row, as its document: rows are replaced whole when the cache reloads
function docOf(row) {
  if (!row) return null;
  if (!parsed.has(row)) parsed.set(row, parseDoc(row.content));
  return parsed.get(row);
}
// A set as it's drawn: a skin laid over its template (resolveSet).
const setOf = (graphics, id) => resolveSet(docOf(graphics.get(id)), (b) => docOf(graphics.get(b)));
export const setOfId = setOf;

export function liveShows(graphics) {
  const out = [];
  for (const row of graphics.values()) {
    if (row.type !== 'show') continue;
    const d = docOf(row);
    if (d?.live) out.push(d);
  }
  return out;
}

// Everybody cast in a show that's on air, for the schedule checker. `type` narrows it to one kind:
// the sports desk keeps its cast on while a slate is on, which mustn't reach a talk show's host.
export function castOnAir(graphics, { type = null } = {}) {
  const ids = new Set();
  for (const s of liveShows(graphics)) if (!type || s.type === type) for (const id of Object.values(s.cast || {})) if (id && !castToken(id)) ids.add(id);
  return ids;
}

// The room a cast member's show is played in: the set of the first slot of a live show of `type`
// they're cast in, or null. The desk's cast are on no playlist row's staff, so this is how they
// know where work is (the broadcast's studio-zone lookup).
export function castStage(graphics, npcId, { type = null } = {}) {
  for (const s of liveShows(graphics)) {
    if (type && s.type !== type) continue;
    if (!Object.values(s.cast || {}).includes(npcId)) continue;
    for (const slot of s.slots || []) {
      const seq = docOf(graphics.get(slot.sequence)), set = seq ? setOf(graphics, seq.set) : null;
      if (set?.zone) return set.zone;
    }
  }
  return null;
}

// The lines of `when`, or null if the broadcast has no live show or nothing plays then. `npcOf` is
// id → { id, name, sex, flags }. A role nobody can fill loses the whole segment: a sequence shot for
// two people can't be played by one.
export function deskSegment(graphics, { broadcast, when, data = {}, seed = '', npcOf }) {
  const show = liveShows(graphics).find((s) => s.broadcast === broadcast);
  const slot = slotFor(show, when, data);
  const seq = slot ? docOf(graphics.get(slot.sequence)) : null, set = seq ? setOf(graphics, seq.set) : null;
  if (!seq || !set) return null;
  const cast = {};
  for (const role of Object.keys(seq.roles || {})) {
    // A role cast as a token ({anchor}) is somebody the broadcast names but the world doesn't hold:
    // a news anchor is a display name. It takes its name from the data and stands for nobody.
    if (castToken(show.cast?.[role])) {
      const name = fill(show.cast[role], data).trim();
      if (!name || name === show.cast[role]) return null;
      // the set may dress them (`looks`, keyed by name), or they're rolled
      const look = set.looks?.[name.toLowerCase()];
      cast[role] = { id: '', name, sex: look?.sex || null, figure: look?.figure || null };
      continue;
    }
    const npc = npcOf(show.cast?.[role]);
    if (!npc) return null;
    cast[role] = { id: npc.id, name: npc.name, sex: npc.sex, figure: npc.flags?.figure || null };
  }
  const full = { show: show.name, ...data };
  const lines = timeline(seq, full, { cast, seed }).filter((it) => it.spoken).map((it) => ({ i: it.i, npc: cast[it.role]?.id || '', name: cast[it.role]?.name || '', text: it.text }));
  if (!lines.length) return null;
  return { show: show.id, stage: set.zone || '', castIds: Object.values(cast).map((c) => c.id).filter(Boolean), lines, pack: { seq, set, cast, data: full, seed } };
}

// The overlay a segment's line carries. The first takes the documents with it, and the last says so.
export const deskOverlay = (seg, line, n) => ({
  overlayType: 'desk', show: seg.show, stage: seg.stage, cast: seg.castIds, beat: line.i,
  ...(n === 0 ? { pack: seg.pack } : {}), ...(n === seg.lines.length - 1 ? { last: true } : {}),
});

// What's true as a segment airs, past what was known when the game was assembled: for its graphics,
// since its lines are already written. `live` is { watching, weather, tempC, ... } from the runner.
export const withLive = (graphic, live) => (graphic.pack ? { ...graphic, pack: { ...graphic.pack, data: { ...graphic.pack.data, live } } } : graphic);

// The set a show is played on when nobody made it a sequence: its entry's, the one built for the room
// it's staged in, one marked for its kind of show, or the default. `uses` on a set is that list, and
// `broadcasts` names the shows a skin was made for, which beats the room. A template is never staged
// as itself, and what comes back is resolved (resolveSet).
export function stageSet(graphics, { broadcast = null, zone = null, type = '' } = {}) {
  // an assembled programme's id carries its kind and day ('bc_x:talkshow:2077-09-05'); the entry names the broadcast
  broadcast = broadcast ? String(broadcast).split(':')[0] : null;
  const sets = [];
  for (const row of graphics.values()) if (row.type === 'set') { const d = docOf(row); if (d) sets.push(d); }
  const raw = (id) => sets.find((s) => s.id === id), byId = (id) => resolveSet(raw(id), raw);
  for (const row of graphics.values()) {
    if (row.type !== 'show') continue;
    const s = docOf(row);
    if (s?.broadcast && s.broadcast === broadcast && s.set && byId(s.set)) return byId(s.set);
  }
  const real = sets.filter((s) => !s.template);
  // Where several sets claim the room (KSAB-TV's main floor is the morning couch, the talk set and the
  // Tonight Show's own), one made for other shows is theirs: the room's set for this kind of show, else
  // its default, else any nobody made for a show. The cache has no order, so the first match is a coin toss.
  const inRoom = zone ? real.filter((s) => s.zone === zone) : [], free = inRoom.filter((s) => !(s.broadcasts || []).length);
  const room = free.find((s) => (s.uses || []).includes(type)) || free.find((s) => (s.uses || []).includes('default')) || free[0] || inRoom[0];
  const hit = (broadcast && real.find((s) => (s.broadcasts || []).includes(broadcast))) || room || real.find((s) => (s.uses || []).includes(type)) || real.find((s) => (s.uses || []).includes('default')) || real[0] || null;
  return hit ? byId(hit.id) : null;
}

// The set a film's scene is staged on, from its SLUG line ("THE OFFICE | BEFORE DAWN"), or null to stay
// where it is. The candidates are the backlot (`backlot: true`, scripts/content/build-film-sets.mjs) and
// any set made for this film that names its own `scenes`; a film whose own set names none is staged on
// that set throughout, so this is null for it. `scenes` is phrase → weight, a phrase matches whole words,
// and one before the pipe (the place) counts double. A tie goes to the phrase further along the place,
// since "THE PRINE HOUSE, THE KITCHEN" is the kitchen. Pure: `graphics` is the cache, id → row.
const sceneWords = (s) => ` ${String(s || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
export function sceneSetFor(graphics, { broadcast = null, slug = '' } = {}) {
  const bid = broadcast ? String(broadcast).split(':')[0] : null;
  const [placeRaw, ...restRaw] = String(slug || '').split('|');
  const place = sceneWords(placeRaw), rest = sceneWords(restRaw.join(' '));
  const own = [], lot = [];
  for (const row of graphics.values()) {
    if (row.type !== 'set') continue;
    const d = docOf(row);
    if (!d || d.template) continue;
    if (bid && (d.broadcasts || []).includes(bid)) own.push(d);
    else if (d.backlot) lot.push(d);
  }
  if (own.length && !own.some((d) => d.scenes)) return null;
  let best = null, top = 0;
  for (const d of [...own.filter((x) => x.scenes), ...lot].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let score = own.includes(d) ? 0.5 : 0;
    for (const [phrase, w] of Object.entries(d.scenes || {})) {
      const p = sceneWords(phrase), at = place.lastIndexOf(p);
      if (p.trim() && at >= 0) score += (+w || 1) * 2 + at * 1e-4;
      else if (p.trim() && rest.includes(p)) score += +w || 1;
    }
    if (score > top + 1e-9 && score >= 1) { top = score; best = d.id; }
  }
  return best;
}

// The set a room IS, for a player standing in it: a set (not a template) whose `zone` is the room, resolved
// over its template. Where several claim one room (KSAB-TV's main floor is the morning couch and the talk
// set), the one marked `roomDefault`, else whose `uses` has 'default'; the server shows whatever's airing
// there first. Null for a room
// no set claims, which stays the Room Stage's ordinary room.
export function roomSet(graphics, zone) {
  if (!zone) return null;
  const sets = [];
  for (const row of graphics.values()) if (row.type === 'set') { const d = docOf(row); if (d) sets.push(d); }
  const raw = (id) => sets.find((x) => x.id === id), mine = sets.filter((x) => !x.template && x.zone === zone);
  const hit = mine.find((x) => x.roomDefault) || mine.find((x) => (x.uses || []).includes('default')) || mine[0];
  return hit ? resolveSet(hit, raw) : null;
}

// Tonight's guest, as the stage seats them. A townsperson who does the show in person is themselves;
// a persona from the ::guests pool is a person of their own, keyed by name so the same persona looks
// the same every time they're booked and two personas never share a face. `title` is their lower third.
export function guestPerson(persona, real = null) {
  if (!persona?.name || persona.name === "Tonight's Guest") return null;
  if (real) return { id: real.id, name: real.name, sex: real.sex, figure: real.flags?.figure || null, title: persona.title || '' };
  return { id: `guest:${persona.name}`, name: persona.name, sex: personaSex(persona), figure: null, title: persona.title || '' };
}
// A persona says what it is in its name or its title, when it does: an honorific, or a pronoun in the
// blurb. Otherwise the figure's own roll, never a guess off a first name.
export function personaSex(persona) {
  const name = String(persona?.name || ''), title = ` ${String(persona?.title || '').toLowerCase()} `;
  if (/^(mr|sir|lord|father|brother|uncle|king)\b\.?/i.test(name)) return 'male';
  if (/^(mrs|ms|miss|lady|dame|mother|sister|aunt|queen)\b\.?/i.test(name)) return 'female';
  const he = (title.match(/\b(he|him|his|himself)\b/g) || []).length, she = (title.match(/\b(she|her|hers|herself)\b/g) || []).length;
  return he > she ? 'male' : she > he ? 'female' : '';
}

// Real shifts: is everybody who's cast standing on the stage? `npcOf` as above.
export function deskStaffed(overlay, npcOf) {
  if (!overlay.stage) return true;
  return (overlay.cast || []).every((id) => { const n = npcOf(id); return !!n && !n._dead && n.zone_id === overlay.stage; });
}

// An advert inside a show, played on its own set. A set claims the logo card that opens it (`cards`),
// may name the scene a DISSOLVE takes it to (`dissolve`), and lists the people in it (`extras`): an NPC
// by id (with `figure` laid over his own look), else a name, sex and figure. The show's own cast stay home, heard but not seen, because the
// extras fill every mark. Null when no set claims the card.
export function breakSetFor(graphics, gid) {
  if (!gid) return null;
  for (const row of graphics.values()) {
    if (row.type !== 'set') continue;
    const d = docOf(row);
    if (d && !d.template && Array.isArray(d.cards) && d.cards.includes(gid)) return d.id;
  }
  return null;
}
export function breakStage(graphics, id, npcOf) {
  const set = id ? setOf(graphics, id) : null;
  if (!set) return null;
  const people = (set.extras || []).map((x) => {
    const n = x.npc ? npcOf(x.npc) : null;
    // an NPC can be dressed for the advert: `figure` here is laid over his own
    if (n) return { id: n.id, name: n.name, sex: n.sex, figure: x.figure ? { ...(n.flags?.figure || {}), ...x.figure } : n.flags?.figure || null };
    return x.name ? { id: `extra:${set.id}:${x.name}`, name: x.name, sex: x.sex || '', figure: x.figure || null } : null;
  }).filter(Boolean);
  return { set, people, dissolve: set.dissolve || null };
}
