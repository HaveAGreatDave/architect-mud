// Surveillance plugin regression suite — run by tests/regress.js (never loaded
// in production). Verb routing plus the crime→star registry defaults/cap.
import { CRIME_DEFAULTS, getCrimeStars, getCrimeList } from '../../server/engine/crimes.js';
import { visFactorForCategory, isSpecterInstalled, cameraBufferLines, microreelList, deleteMicroreel, __refreshRecordingCams, __captureZoneLine, __cameraFrames, __cameraFull } from './index.js';
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';

export default async function regress({ run, check, getPlayer }) {
  const r = await run('wanted');
  check('wanted verb routed', /clean|WANTED/.test(r?.message || ''), r?.message);

  // apprehendresolve is the silent client→server resolve for the arrest prompt.
  // With no prompt live it must no-op cleanly (never throw / never mis-arrest).
  const ar = await run('apprehendresolve submit');
  check('apprehendresolve no-ops with no prompt', ar?.type === 'noop', ar?.type);
  const ar2 = await run('apprehendresolve run');
  check('apprehendresolve run no-ops with no prompt', ar2?.type === 'noop', ar2?.type);

  // collect physicalizes an auto-banked evidence clip; with none on record for
  // the fake player it must report cleanly rather than throw.
  const col = await run('collect');
  check('collect with no clips errors cleanly', col?.type === 'error' && /no un-collected evidence/i.test(col?.message || ''), col?.message);

  // clip needs a deployed device; the fake player owns none.
  const clip = await run('clip');
  check('clip with no device errors cleanly', clip?.type === 'error' && /no deployed device/i.test(clip?.message || ''), clip?.message);

  // purge is admin-only: a normal player gets the generic unknown-command reply
  // (the verb stays hidden); an admin runs it clean with no police in the room.
  const denied = await run('purge');
  check('purge denied for non-admin', /Unknown command/.test(denied?.message || ''), denied?.message);
  const p = getPlayer();
  const prevRole = p.role;
  p.role = 'admin';
  const purged = await run('purge');
  check('purge clears cleanly for admin', purged?.type === 'system' && /Slate wiped/.test(purged?.message || ''), purged?.message);
  p.role = prevRole;

  // Crime registry ships the five canonical acts with the spec'd star weights.
  check('drug_use default = 0.5 stars', getCrimeStars('drug_use') === 0.5, getCrimeStars('drug_use'));
  check('attack_player default = 4 stars', getCrimeStars('attack_player') === 4, getCrimeStars('attack_player'));
  check('attack_npc default = 4 stars', getCrimeStars('attack_npc') === 4, getCrimeStars('attack_npc'));
  check('kill_police default = 5 stars', getCrimeStars('kill_police') === 5, getCrimeStars('kill_police'));
  check('hacking default = 2 stars', getCrimeStars('hacking') === 2, getCrimeStars('hacking'));
  check('unknown crime = 0 stars', getCrimeStars('nope') === 0, getCrimeStars('nope'));

  const list = getCrimeList();
  check('crime list covers all defaults', list.length === Object.keys(CRIME_DEFAULTS).length, list.length);
  check('drug_use caught by camera only', list.find(c => c.id === 'drug_use')?.witness === 'camera');
  check('kill_police always reported', list.find(c => c.id === 'kill_police')?.witness === 'always');

  // PD cameras see worse in low visibility: catch rate is full at `clear`+ and
  // steps down per darkness band, floored so a blackout isn't a free pass.
  check('camera full rate in clear conditions', visFactorForCategory('clear') === 1);
  check('camera full rate when brighter than clear', visFactorForCategory('blazing') === 1);
  check('camera full rate on unknown visibility', visFactorForCategory(undefined) === 1);
  check('camera degrades one step below clear', Math.abs(visFactorForCategory('dim') - 0.82) < 1e-9, visFactorForCategory('dim'));
  check('camera catch rate falls as it darkens', visFactorForCategory('dark') < visFactorForCategory('gloomy'));
  check('camera floors at ~10% in pitch dark', Math.abs(visFactorForCategory('pitch_dark') - 0.1) < 1e-6, visFactorForCategory('pitch_dark'));

  // ── SPECTER install program (the hack deck) ─────────────────────────────────
  await setFlag('player', 'specter_installed', '0', p);
  check('isSpecterInstalled false before install', (await isSpecterInstalled(p)) === false);

  // Carry a program chip and `use` it: installs SPECTER (flag) + burns the item.
  await query(
    `INSERT INTO items (id,name,description,type,weight,value,tags)
     VALUES ('item_specter_program','SPECTER Firmware Drive','','device',100,1500,'{"specter_program":true}')
     ON CONFLICT (id) DO NOTHING`
  );
  await query("DELETE FROM player_inventory WHERE player_id=$1 AND item_id='item_specter_program'", [p.id]);
  await query(
    "INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ('inv_regress_specter',$1,'item_specter_program',1)",
    [p.id]
  );
  const inst = await run('use SPECTER Firmware Drive');
  check('use SPECTER program triggers the install animation + reports install', inst?.type === 'specter_install' && /installed/i.test(inst?.message || ''), JSON.stringify(inst)?.slice(0, 160));
  check('SPECTER install sets the flag', (await isSpecterInstalled(p)) === true);
  const { rows: leftover } = await query("SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id='item_specter_program'", [p.id]);
  check('SPECTER install consumes the program item', leftover.length === 0, `rows=${leftover.length}`);

  await query("DELETE FROM player_inventory WHERE player_id=$1 AND item_id='item_specter_program'", [p.id]);
  await setFlag('player', 'specter_installed', '0', p);

  // ── Event-line recording (sticky-cams log zone activity, rolling buffer) ─────
  const CAM_ID = 'secdev_regress_cam';
  const { rows: zoneRow } = await query('SELECT id FROM zones LIMIT 1'); // real zone (zone_id has an FK)
  const CAM_ZONE = zoneRow[0]?.id;
  await query('DELETE FROM security_devices WHERE id=$1', [CAM_ID]);
  await query(
    `INSERT INTO security_devices (id, owner_id, device_kind, zone_id, direction, tier,
       concealment, battery, battery_max, wired, is_damaged, is_recording, hack_difficulty, placed_at)
     VALUES ($1,$2,'sticky_cam',$3,'north',1,5,100,864,0,0,1,5,0)`,
    [CAM_ID, p.id, CAM_ZONE]
  );
  await __refreshRecordingCams(); // index the recording cam into its zone

  __captureZoneLine(CAM_ZONE, { type: 'say', message: 'Kaz says: "meet me at the docks"' });
  __captureZoneLine(CAM_ZONE, { type: 'zone_event', message: 'Vann arrives from the north.' });
  __captureZoneLine(CAM_ZONE, { type: 'ambient', message: 'A neon sign buzzes overhead.' }); // not whitelisted
  let frames = __cameraFrames(CAM_ID);
  check('sticky-cam logs speech + movement as lines', frames.length === 2 && /docks/.test(frames[0].text) && /arrives/.test(frames[1].text), JSON.stringify(frames)?.slice(0, 200));
  check('sticky-cam ignores ambient (non-whitelisted) lines', frames.every(f => !/neon sign/.test(f.text)), JSON.stringify(frames)?.slice(0, 160));
  check('logged lines are HTML-stripped plain text', frames.every(f => !/[<>]/.test(f.text)), JSON.stringify(frames)?.slice(0, 160));
  // Lines are kind-tagged so the microreel viewer can colour speech apart from narration.
  check('speech line tagged kind=say', frames[0].kind === 'say', JSON.stringify(frames[0]));
  check('narration/movement line tagged kind=event', frames[1].kind === 'event', JSON.stringify(frames[1]));

  // Buffer STOPS at the tunable cap (default 25) — it does not roll over. 40 more
  // distinct lines → the buffer holds the FIRST 25 pushed and marks itself full.
  for (let i = 0; i < 40; i++) __captureZoneLine(CAM_ZONE, { type: 'say', message: `line number ${i}` });
  frames = __cameraFrames(CAM_ID);
  check('buffer caps at the configured line budget', frames.length === 25, `len=${frames.length}`);
  check('buffer stops (keeps oldest, drops nothing recorded before the cap)', /line number 22/.test(frames[frames.length - 1].text), frames[frames.length - 1].text);
  check('a full buffer marks itself full (stops recording until reset)', __cameraFull(CAM_ID) === true, `full=${__cameraFull(CAM_ID)}`);

  // The tablet reads this same buffer (owner-gated) to show what's on tape.
  const mine = await cameraBufferLines(p, CAM_ID);
  check('cameraBufferLines returns the owner buffer', mine.length === 25 && mine[0].kind, `len=${mine.length}`);
  const notMine = await cameraBufferLines({ id: 'someone_else' }, CAM_ID);
  check('cameraBufferLines refuses a non-owner', notMine.length === 0, `len=${notMine.length}`);

  // ── Clip (→ microreel + clear buffer) and wipe (clear only) ─────────────────
  // Both verbs join furniture, so give the cam a furniture row.
  await query('DELETE FROM furniture WHERE id=$1', [CAM_ID]);
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags, origin, owner_id)
     VALUES ($1,$2,'Regress Cam','','security_device',$3,'player',$4)`,
    [CAM_ID, CAM_ZONE, JSON.stringify({ security_device: true, device_id: CAM_ID, concealed: true }), p.id]
  );
  await query('DELETE FROM security_clips WHERE owner_id=$1', [p.id]);
  const clipRes = await run('clip Regress Cam');
  check('clip saves a microreel (not a datachip)', clipRes?.type === 'output' && /microreel/i.test(clipRes?.message || ''), JSON.stringify(clipRes)?.slice(0, 160));
  check('clip clears the buffer so the cam records again', __cameraFrames(CAM_ID).length === 0 && __cameraFull(CAM_ID) === false, `len=${__cameraFrames(CAM_ID).length} full=${__cameraFull(CAM_ID)}`);
  const reels = await microreelList(p);
  check('clipped microreel appears in the owner reel list', reels.length >= 1 && reels[0].frames === 25, JSON.stringify(reels[0])?.slice(0, 160));
  const { rows: chipItems } = await query("SELECT 1 FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')", [p.id]);
  check('clipping does NOT mint a physical datachip', chipItems.length === 0, `chips=${chipItems.length}`);

  // Refill, then wipe: buffer clears without saving another reel.
  __captureZoneLine(CAM_ZONE, { type: 'say', message: 'one more for the tape' });
  check('buffer refills after a clip', __cameraFrames(CAM_ID).length === 1, `len=${__cameraFrames(CAM_ID).length}`);
  const wipeRes = await run('wipe Regress Cam');
  check('wipe reports the discard', wipeRes?.type === 'output' && /wipe/i.test(wipeRes?.message || ''), JSON.stringify(wipeRes)?.slice(0, 160));
  check('wipe clears the buffer without saving a reel', __cameraFrames(CAM_ID).length === 0, `len=${__cameraFrames(CAM_ID).length}`);
  const reelsAfterWipe = await microreelList(p);
  check('wipe did not add a reel', reelsAfterWipe.length === reels.length, `before=${reels.length} after=${reelsAfterWipe.length}`);

  // deleteMicroreel: a bogus / non-owned id is refused; a real one is destroyed for good.
  const bogusDel = await deleteMicroreel(p, 'clip_does_not_exist');
  check('deleteMicroreel refuses an unknown/non-owned reel', bogusDel?.ok === false, JSON.stringify(bogusDel));
  const delRes = await deleteMicroreel(p, reelsAfterWipe[0].clipId);
  check('deleteMicroreel destroys the owner reel', delRes?.ok === true, JSON.stringify(delRes));
  const reelsAfterDelete = await microreelList(p);
  check('destroyed reel is gone from the owner reel list', reelsAfterDelete.length === reelsAfterWipe.length - 1, `before=${reelsAfterWipe.length} after=${reelsAfterDelete.length}`);

  await query('DELETE FROM security_clips WHERE owner_id=$1', [p.id]);
  await query('DELETE FROM furniture WHERE id=$1', [CAM_ID]);
  await query('DELETE FROM security_devices WHERE id=$1', [CAM_ID]);
}
