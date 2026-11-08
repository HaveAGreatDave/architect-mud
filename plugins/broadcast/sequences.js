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

import { parseDoc, timeline, slotFor, fill, castToken } from '../../client/shared/sequence.js';

const parsed = new WeakMap();   // a row, as its document: rows are replaced whole when the cache reloads
function docOf(row) {
  if (!row) return null;
  if (!parsed.has(row)) parsed.set(row, parseDoc(row.content));
  return parsed.get(row);
}

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

// The lines of `when`, or null if the broadcast has no live show or nothing plays then. `npcOf` is
// id → { id, name, sex, flags }. A role nobody can fill loses the whole segment: a sequence shot for
// two people can't be played by one.
export function deskSegment(graphics, { broadcast, when, data = {}, seed = '', npcOf }) {
  const show = liveShows(graphics).find((s) => s.broadcast === broadcast);
  const slot = slotFor(show, when, data);
  const seq = slot ? docOf(graphics.get(slot.sequence)) : null, set = seq ? docOf(graphics.get(seq.set)) : null;
  if (!seq || !set) return null;
  const cast = {};
  for (const role of Object.keys(seq.roles || {})) {
    // A role cast as a token ({anchor}) is somebody the broadcast names but the world doesn't hold:
    // a news anchor is a display name. It takes its name from the data and stands for nobody.
    if (castToken(show.cast?.[role])) {
      const name = fill(show.cast[role], data).trim();
      if (!name || name === show.cast[role]) return null;
      cast[role] = { id: '', name, sex: null, figure: null };
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
// it's staged in, one marked for its kind of show, or the default. `uses` on a set is that list.
export function stageSet(graphics, { broadcast = null, zone = null, type = '' } = {}) {
  // an assembled programme's id carries its kind and day ('bc_x:talkshow:2077-09-05'); the entry names the broadcast
  broadcast = broadcast ? String(broadcast).split(':')[0] : null;
  const sets = [];
  for (const row of graphics.values()) if (row.type === 'set') { const d = docOf(row); if (d) sets.push(d); }
  const byId = (id) => sets.find((s) => s.id === id);
  for (const row of graphics.values()) {
    if (row.type !== 'show') continue;
    const s = docOf(row);
    if (s?.broadcast && s.broadcast === broadcast && s.set && byId(s.set)) return byId(s.set);
  }
  return (zone && sets.find((s) => s.zone === zone)) || sets.find((s) => (s.uses || []).includes(type)) || sets.find((s) => (s.uses || []).includes('default')) || sets[0] || null;
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
