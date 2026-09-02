// Audio plugin regress.
//
// One case, and it is the one that shipped a bug: WHAT COUNTS AS A POWER DEVICE.
// The industrial ambient bed — the power-station roar and the utility-room hum —
// is chosen by looking for the room's power device, and that test used to be
// "has an HP bar", i.e. destructible. A microwave is destructible. So every
// Solenne apartment, the four Merrow units, the grocery and the laundromat ran a
// machine-room drone off a kitchen appliance, a folding table and a row of
// dryers, permanently, with nothing in the room to explain the noise.
export default async ({ check }) => {
  const { isPowerDevice } = await import('./index.js');

  check('a generator is a power device', isPowerDevice({ object_type: 'generator', hp_max: 100 }));
  check('…and so is a junction box', isPowerDevice({ object_type: 'junction_box', hp_max: 40 }));

  // The bug, pinned. Every one of these is a real row in the world that used to
  // qualify — same shape, same hp_max, no business humming.
  check('a microwave is NOT, however breakable',
    !isPowerDevice({ object_type: 'fixture', name: 'Polaris Executive Convection Unit', hp_max: 40 }));
  check('…nor a row of dryers', !isPowerDevice({ object_type: 'fixture', name: 'facing row of dryers', hp_max: 30 }));
  check('…nor a folding table', !isPowerDevice({ object_type: 'furniture', name: 'folding table', hp_max: 10 }));

  // An indestructible junction box is a content error, not a hum: the bed is for
  // a device that can be smashed to kill it, so no hp_max means no bed.
  check('a power device with no HP bar does not count', !isPowerDevice({ object_type: 'junction_box', hp_max: null }));
  check('and nothing at all does not throw', !isPowerDevice(null) && !isPowerDevice(undefined));

  // ── The dense sound tier ──────────────────────────────────────────────────
  const { footingFor, lockFamilyOf, TERRAIN_STEP, FLOOR_STEP } = await import('./index.js');
  await import('../../client/shared/procedural-sfx.js');
  const P = globalThis.ProceduralSFX;

  // THE ONE THAT KEEPS THE MAPPING HONEST. Terrain grows — this system does not
  // find out when it does, and an unmapped terrain is silently the wrong ground
  // under a whole region rather than an error anybody would notice. So the
  // catalog's own enum is the checklist.
  // tagCatalog is dual-mode and has no named exports — importing it for the side
  // effect is how every other consumer reads it.
  await import('../../client/shared/tagCatalog.js');
  const terrains = globalThis.TAG_CATALOG.terrain.options;
  const unmapped = terrains.filter(t => !TERRAIN_STEP[t]);
  check(`every one of the ${terrains.length} terrain values maps to a footing class${unmapped.length ? ` — missing: ${unmapped.join(', ')}` : ''}`,
    unmapped.length === 0);
  // …and every class either side names a real row in the generator's table.
  const classes = new Set([...Object.values(TERRAIN_STEP), ...Object.values(FLOOR_STEP), 'stone', 'boards']);
  const unknown = [...classes].filter(c => !P.FOOTSTEPS[c]);
  check(`every footing class exists in the FOOTSTEPS table${unknown.length ? ` — missing: ${unknown.join(', ')}` : ''}`,
    unknown.length === 0);

  // Outdoors reads terrain; indoors reads the authored floor. The fallback is the
  // point of the third case: an interior nobody has authored must still make a
  // sound, because silence is indistinguishable from the feature being broken.
  check('an outdoor tile is voiced by its terrain', footingFor({ flags: { terrain: 'marsh' } }) === 'marsh');
  check('an authored interior is voiced by its floor', footingFor({ flags: { is_interior: true, floor: 'tile' } }) === 'tile');
  check('an interior with NO floor falls back to boards, never to silence',
    footingFor({ flags: { is_interior: true } }) === 'boards');
  check('a building footprint with no terrain and no interior flag is pavement',
    footingFor({ flags: {} }) === 'stone');

  // The lock family comes off the door's own authored tag. Nothing new is
  // authored for sound, which is the whole reason doors were affordable.
  check('a lock family is read off the door\'s own tag',
    lockFamilyOf({ tags: { 'lock:hololock': {} } }) === 'hololock');
  check('an unlocked door has no family', lockFamilyOf({ tags: { unbreakable: true } }) === null);
  check('a door with no tags at all does not throw', lockFamilyOf({}) === null && lockFamilyOf(null) === null);

  // Every cue the two emitters can produce has to build a sound. A cue that
  // returns null is a silent door, and a silent door is exactly as informative
  // as no feature.
  const cues = [
    { action: 'footstep', surface: 'grass' },
    { action: 'door', surface: 'shoddy', state: 'open' },
    { action: 'door', surface: 'reinforced', state: 'close', powered: true },
    { action: 'lock', surface: 'hololock', state: 'lock' },
    { action: 'lock', surface: 'hololock', state: 'unlock' },
    { action: 'lock', surface: 'deadbolt', state: 'denied' },
  ];
  const dead = cues.filter(c => !P.buildActionCue({ ...c, seed: 1 })?.config?.layers?.length);
  check(`all ${cues.length} dense-tier cues build a sound${dead.length ? ` — dead: ${dead.map(c => c.action + '/' + c.state).join(', ')}` : ''}`,
    dead.length === 0);

  // Server and client rebuild the identical cue from the seed, or the room hears
  // a different footstep from the person taking it.
  const a = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'gravel', seed: 99 }));
  const b = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'gravel', seed: 99 }));
  check('a seeded step is reproducible', a === b);

  // A denied lock must not sound like one that worked — this is the only cue in
  // the game whose job is to carry a refusal to somebody who is not reading.
  const denied = JSON.stringify(P.buildActionCue({ action: 'lock', surface: 'hololock', state: 'denied', seed: 5 }));
  const opened = JSON.stringify(P.buildActionCue({ action: 'lock', surface: 'hololock', state: 'unlock', seed: 5 }));
  check('a refused lock does not sound like an opened one', denied !== opened);

  // ── Bearable for hours, and blended ───────────────────────────────────────
  //
  // This is the cue a player fires on nearly every input for as long as they
  // play, so these three are not polish — they are the difference between a
  // footstep system and a tapping noise nobody can switch off fast enough.

  // Alternating feet. Random jitter is heard as NOISE; an alternating pair is
  // heard as walking. If these two ever collapse to one sound, the cadence
  // becomes a loop and the whole thing starts grating within a minute.
  const left = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'stone', foot: 0, seed: 4 }));
  const right = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'stone', foot: 1, seed: 4 }));
  check('the two feet are audibly different at the same seed', left !== right);

  // Wetness blends the step INTO the rain rather than under it — a dry hard
  // surface gains a splash layer and loses some of its strike.
  const dry = P.buildActionCue({ action: 'footstep', surface: 'stone', wet: 0, seed: 4 });
  const soaked = P.buildActionCue({ action: 'footstep', surface: 'stone', wet: 1, seed: 4 });
  check('rain puts water on a hard surface', soaked.config.layers.length > dry.config.layers.length);
  // …and a surface that is already water cannot get wetter, or a marsh in a
  // downpour would double up on a splash it already has.
  const marshDry = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'water', wet: 0, seed: 4 }));
  const marshWet = JSON.stringify(P.buildActionCue({ action: 'footstep', surface: 'water', wet: 1, seed: 4 }));
  check('an already-wet surface is unchanged by rain', marshDry === marshWet);

  // The tuning surface. These tables are the knobs, and they reach the dev panel
  // only by being registered — one missing row is a table nobody can tune.
  for (const id of ['proc:footsteps', 'proc:doors', 'proc:locks']) {
    check(`${id} is registered for the dev panel`, !!P.TABLE_IDS[id]);
  }

  // ── The library list routes answer from RAM ───────────────────────────────
  // /audio/songs is PUBLIC and the game client calls it on every AMP panel open,
  // so when it ran `SELECT *` it pulled 2.7MB of tracker patterns out of Neon per
  // open. The rows were already in the boot cache. What has to stay true is that
  // the cached answer is the SAME answer — every row, name-ordered, channels
  // intact — because the client filters on `channels.length` and a shape change
  // here empties the AMP rather than erroring.
  const { routeHandler } = await import('./index.js');
  const { query } = await import('../../server/models/db.js');

  const list = await routeHandler('/audio/songs', 'GET', null, null, {});
  const { rows: dbSongs } = await query('SELECT id, name FROM audio_songs');
  check('/audio/songs answers 200 from the cache', list?.status === 200 && Array.isArray(list.body));
  check('…with every song the table holds', list.body.length === dbSongs.length,
    `route ${list?.body?.length} vs db ${dbSongs.length}`);
  check('…name-ordered, as ORDER BY name was',
    list.body.every((r, i) => i === 0 || String(list.body[i - 1].name).localeCompare(String(r.name)) <= 0));
  check('…carrying the channels the client filters on',
    list.body.every(r => Array.isArray(r.channels)),
    list.body.filter(r => !Array.isArray(r.channels)).map(r => r.name).join(', '));

  // Same route shape for samples, where the invariant is the opposite one: the
  // cache holds SAMPLE_META_COLS and the base64 blob must NOT ride along, or a
  // list fetch becomes a 12MB download.
  const smp = await routeHandler('/audio/samples', 'GET', null, null, {});
  check('/audio/samples answers from the cache too', smp?.status === 200 && Array.isArray(smp.body));
  check('…and never carries the sample blob', smp.body.every(r => r.data === undefined),
    smp.body.filter(r => r.data !== undefined).map(r => r.name).join(', '));
};
