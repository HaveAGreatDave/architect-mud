/**
 * The depot bunkrooms: make the televisions work, and let people sleep.
 *
 * Five rooms, authored complete — four cots, a fridge, a sink, a strip light and
 * a bracketed television each — and neither of the two things the room is FOR
 * actually worked.
 *
 * ── THE TELEVISIONS ─────────────────────────────────────────────────────────
 *
 * Three separate defects, all in the same batch, and each one silent:
 *
 *  1. `is_tv` instead of `tv`. The broadcast plugin's receiver filter is
 *     `f.flags?.tv && f.flags?.broadcast_receiver` (plugins/broadcast/index.js,
 *     and the identical pair in commands/describe.js). `is_tv` is read in
 *     exactly ONE place in the codebase — `server/engine/classify.js`, the
 *     shelf/container SECTIONING heuristic — where it helps decide which pile a
 *     thing goes in and has nothing to do with watching it. So the sets were
 *     televisions for the purposes of tidying a list and for nothing else.
 *
 *  2. No `broadcast_receiver`. Same filter, and also `nearestReceiver`, which is
 *     what finds you a screen in the room.
 *
 *  3. Tuned to channel 3, WHICH DOES NOT EXIST. The world has three channels —
 *     0 (VCR), 7 (KSAB-TV) and 11 (St Garneau Stream) — so even with the flags
 *     right, every one of these sets would have come up dead. Retuned to 7, the
 *     channel every other television in the game defaults to.
 *
 * `interactions: ['watch']` is added too, so the set offers the verb on examine
 * and the smart bar rather than being a thing you have to know to type at.
 *
 * ⚠ `is_tv` is DROPPED rather than left alongside `tv`. Editing a content file
 * is enough to remove a JSONB key (the importer replaces the whole column), and
 * leaving both would be a second spelling of one idea for the next author to
 * pick the wrong one of.
 *
 * ── SLEEP ───────────────────────────────────────────────────────────────────
 *
 * `sleepContext` (server/engine/apartments.js) walks: your own apartment →
 * `sanctuary` → `allow_sleep` → a bed you brought → **unsafe**. The bunkrooms
 * carried none of those, so the cots were furniture with a `sleep` interaction
 * on them in a room that refused the verb.
 *
 * `sanctuary` is the right flag rather than `allow_sleep` alone, because the ask
 * was a SAFE place: sanctuary is the bundle that also blocks enemy spawns
 * (world.js), stops hostiles pathing in (ai-behaviour.js), reads as `safe` to
 * danger.js and shows ⛨ SANCTUARY on the room. `allow_sleep` on its own is the
 * holding-cell case — rest permitted, no protection — which is not what a paid
 * bunk at a depot is selling.
 *
 * Both are set, matching `zone_lw_bunk`, the game's other bunkroom. Sanctuary
 * short-circuits first so `allow_sleep` is strictly redundant at runtime; it is
 * here because it is the marker an author greps for, and disagreeing with the
 * established precedent to save one key would cost more than it saves.
 *
 * NOT set: `is_dwelling` (zone-tags.js reserves that for somewhere a person
 * genuinely LIVES; a depot bunk is a workplace amenity), `unsurveilled` (a
 * haulage company would absolutely have cameras), and `safehouse` (read only by
 * surveillance, for faster wanted-star decay — a Long Watch hideout property,
 * not a company one).
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content');
const DEPOTS = ['bonded', 'deadleg', 'dryrun', 'lastload', 'roadhead'];

// KSAB-TV. The only general broadcast channel in the world; 0 is the VCR and 11
// is a stream. Channel 3, which these were tuned to, is not anything.
const CHANNEL = 7;

const load = (dir, id) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, `${id}.json`), 'utf8'));
const save = (dir, obj) => {
  fs.writeFileSync(path.join(ROOT, dir, `${obj.id}.json`), canonicalJson(obj), 'utf8');
  console.log(`  updated content/${dir}/${obj.id}.json`);
};

console.log('— the televisions —');
for (const d of DEPOTS) {
  const f = load('furniture', `furn_bunk_${d}_tv`);
  const { is_tv, ...rest } = f.flags || {};   // drop the inert key
  f.flags = {
    ...rest,
    tv: true,
    broadcast_receiver: true,
    interactions: ['watch'],
    channel_default: CHANNEL,
    tuned_channel: CHANNEL,
    tv_dial_freq: CHANNEL,
  };
  save('furniture', f);
}

console.log('— somewhere to sleep —');
for (const d of DEPOTS) {
  const z = load('zones', `zone_bunk_${d}`);
  z.flags = { ...z.flags, sanctuary: true, allow_sleep: true };
  save('zones', z);
}

console.log('done.');
