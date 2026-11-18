// Compile a scripted studio show's .bsm into its media_broadcasts row.
//
// A studio show is a scripted sitcom or sketch written for one Broadcast Studio set: its speakers sit
// on the set's marks, its CAM lines name the set's cameras, and every stage direction is a verb that
// actOfLine (client/shared/npc-acts.js) turns into a clip. This script refuses a file where that
// isn't true, so a line that would air as a person doing nothing fails here and not on the TV.
//
//   node scripts/content/build-studio-show.mjs data/scripts/arrears.bsm bc_arrears set_arrears_living
//
// It writes the whole row: the graph, the messages and the title card assets. The schedule is a
// media_channel_playlist file, which this doesn't touch.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { actOfLine } from '../../client/shared/npc-acts.js';
import { ACTOR_ACTS } from '../../client/game/js/panels/actor3d.js';
import { parseDoc, resolveSet } from '../../client/shared/sequence.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const [src, id, setId] = process.argv.slice(2);
if (!src || !id || !setId) { console.error('usage: build-studio-show.mjs <file.bsm> <broadcast id> <set id>'); process.exit(1); }

const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const c = compileBsm(rd(src));
const errs = [];
if (c.meta.type !== 'scripted') errs.push(`@type is ${c.meta.type}, expected scripted`);
if (c._debug.unknownDirectives.length) errs.push(`unknown directives: ${c._debug.unknownDirectives.join(' | ')}`);
if (c._debug.unresolvedSpeakers.length) errs.push(`unresolved speakers: ${c._debug.unresolvedSpeakers.map((s) => s.label).join(', ')}`);

// the set, as the game resolves it, so the marks and cameras checked are the ones that air
const docs = {};
for (const f of fs.readdirSync(path.join(ROOT, 'content/media_graphics'))) {
  const row = JSON.parse(rd(`content/media_graphics/${f}`));
  if (row.type === 'set') { const d = parseDoc(row.content); if (d) docs[d.id] = d; }
}
const set = docs[setId] && resolveSet(docs[setId], (k) => docs[k]);
if (!set) errs.push(`no set ${setId}`);
else {
  if (![].concat(set.broadcasts || []).includes(id)) errs.push(`${setId} doesn't list ${id} in broadcasts, so the TV won't stage the show on it`);
  const marks = set.marks || {};
  if (c.actorIds.length > Object.keys(marks).length) errs.push(`${c.actorIds.length} actors and only ${Object.keys(marks).length} marks`);
  const kept = new Set(Object.values(marks).flatMap((m) => [].concat(m.for || [])).map((x) => String(x).toLowerCase()));
  const billed = Object.values(c.broadcastGraph.nodes).filter((n) => n.type === 'npc_anchor' && n.display).map((n) => n.display);
  for (const b of new Set(billed)) {
    if (!kept.has(b.toLowerCase())) errs.push(`no mark on ${setId} is kept for "${b}"`);
    if (!set.looks?.[b.toLowerCase()]?.sex) errs.push(`${setId} has no looks.sex for "${b}"`);
  }
  const cams = Object.keys(set.cameras || {}).length;
  for (const n of c.cameras) if (Number(n) > cams) errs.push(`CAM ${n} but ${setId} has ${cams} cameras`);
  // every stage direction has to be something the body can do on its mark
  const poseOf = {};
  for (const m of Object.values(marks)) for (const who of [].concat(m.for || [])) poseOf[String(who).toLowerCase()] = m.pose || 'stand';
  let who = '';
  for (let nid = c.broadcastGraph._start, seen = new Set(); nid && !seen.has(nid); nid = c.broadcastGraph.nodes[nid]?.next) {
    seen.add(nid);
    const n = c.broadcastGraph.nodes[nid];
    if (n.type === 'npc_anchor') who = String(n.display || '').toLowerCase();
    if (n.type !== 'npc_action') continue;
    const act = actOfLine(n.message), pose = poseOf[who] || 'stand';
    if (!act) errs.push(`"${n.message}" isn't an act`);
    else if (!ACTOR_ACTS[act]?.[pose]) errs.push(`"${n.message}" is ${act}, which ${who} can't do (${pose})`);
  }
}
if (errs.length) { for (const e of errs) console.error(`x ${src}: ${e}`); process.exit(1); }

const file = path.join(ROOT, `content/media_broadcasts/${id}.json`);
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const row = {
  acted: false, category: c.meta.category || 'general', channel_id: old.channel_id || 'ch_7_1782953079593',
  created_by: 'author', description: old.description || '', enabled: 1, fallback_messages: [], film_meta: null,
  gameshow_pools: null, id, loop: 1, message_interval: 5, messages: c.messages, morning_pools: null,
  name: c.meta.name, news_pools: null, override_duration: c.meta.length || 180, playback_mode: 'scripted',
  sermon_pools: null, sports_pools: null, tags: old.tags || ['comedy', 'episodic', 'studio'], talkshow_pools: null,
  updated_at: String(Math.floor(Date.now() / 1000)), weather_pools: null,
  broadcast_graph: c.broadcastGraph,
};
fs.writeFileSync(file, canonicalJson(row));
// the title card art rides as a media_graphics ascii row, as the dev panel's importer writes it
for (const a of c.assets) {
  const g = path.join(ROOT, `content/media_graphics/${a.id}.json`);
  const prev = fs.existsSync(g) ? JSON.parse(fs.readFileSync(g, 'utf8')) : {};
  fs.writeFileSync(g, canonicalJson({ content: a.content, created_at: prev.created_at || row.updated_at, description: prev.description || '', id: a.id, name: a.name, tags: prev.tags || [], type: a.type, updated_at: row.updated_at }));
}
console.log(`ok ${id}: ${Object.keys(c.broadcastGraph.nodes).length} nodes, ${c.actorIds.length} actors, ${c.assets.length} asset(s)`);
