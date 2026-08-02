// Surveillance plugin regression suite — run by tests/regress.js (never loaded
// in production). Verb routing plus the crime→star registry defaults/cap.
import { CRIME_DEFAULTS, getCrimeStars, getCrimeList } from '../../server/engine/crimes.js';
import { visFactorForCategory, isSpecterInstalled, cameraBufferLines, microreelList, deleteMicroreel, isWitnessed, witnessRoll, sevFactor, __refreshRecordingCams, __captureZoneLine, __cameraFrames, __cameraFull, selfDestructDevice, __expireStickyCams, __stickyCamTtl, __isSelfDefence } from './index.js';
import { emit } from '../../server/engine/events.js';
import { getTimeScale } from '../../server/engine/gametime.js';
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { reloadItem } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, getZone } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  const r = await run('wanted');
  check('wanted verb routed', /clean|WANTED/.test(r?.message || ''), r?.message);

  // apprehendresolve is the silent client→server resolve for the arrest prompt.
  // With no prompt live it must no-op cleanly (never throw / never mis-arrest).
  const ar = await run('apprehendresolve submit');
  check('apprehendresolve no-ops with no prompt', ar?.type === 'noop', ar?.type);
  const ar2 = await run('apprehendresolve run');
  check('apprehendresolve run no-ops with no prompt', ar2?.type === 'noop', ar2?.type);

  // Self-defence: only the instigator wears the assault charge. An NPC throwing the
  // first punch (gameLoop's `npc.aggressed`) buys the victim a pass to swing back at
  // THAT foe — and nobody else.
  {
    const p = getPlayer();
    check('no self-defence claim before anyone swings', !__isSelfDefence(p.id, 'npc:npc_regress_thug'));
    emit('npc.aggressed', { npc: { id: 'npc_regress_thug' }, target: p });
    check('NPC throwing the first punch makes the player a defender',
      __isSelfDefence(p.id, 'npc:npc_regress_thug'));
    check('the pass is per-foe — it does not cover a bystander',
      !__isSelfDefence(p.id, 'npc:npc_regress_bystander'));
    emit('player.attacked', { attacker: { id: 'attacker_regress', handle: 'Regress', current_zone: null }, target: p });
    check('being attacked by a player makes the victim a defender against them',
      __isSelfDefence(p.id, 'player:attacker_regress'));
  }

  // collect physicalizes an auto-banked evidence clip; with none on record for
  // the fake player it must report cleanly rather than throw.
  const col = await run('collect');
  check('collect with no clips errors cleanly', col?.type === 'error' && /no un-collected evidence/i.test(col?.message || ''), col?.message);

  // clip needs a deployed device; the fake player owns none.
  const clip = await run('clip');
  check('clip with no device errors cleanly', clip?.type === 'error' && /no deployed device/i.test(clip?.message || ''), clip?.message);

  // `hijack` now needs a carried `hack_device`, same as the ATM, the hololock, both
  // vaults and the practice rig — breaching a camera is the same act as breaching a
  // safe. The gate deliberately sits BELOW the device-exists check so a mistyped name
  // still answers "there's no X here" (the useful error) rather than lecturing about
  // hardware, which is exactly what these two assertions pin: no args → the usage
  // error, a name that matches nothing → the not-here error, neither mentioning a
  // device. The empty-handed refusal itself needs a real security_device in the room
  // and is covered by manual QA.
  const hjNone = await run('hijack');
  check('hijack with no args asks what', hjNone?.type === 'error' && /hijack what/i.test(hjNone?.message || ''), hjNone?.message);
  const hjGhost = await run('hijack ghostcam_xyz');
  check('hijack of a device that is not here says so, not "you need a device"',
    hjGhost?.type === 'error' && /no "ghostcam_xyz" here/i.test(hjGhost?.message || '') && !/hacking device/i.test(hjGhost?.message || ''),
    hjGhost?.message);

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

  // ── Unsurveilled zones (the Long Watch bunker) ──────────────────────────────
  // A zone flagged `unsurveilled` is off the Architect's grid: the witness roll
  // short-circuits to "unseen" BEFORE anything else — even a forced 'always'
  // witness. Prove it against a normal zone (always ⇒ seen) vs the bunker.
  const anyZone = (await query('SELECT id FROM zones WHERE (flags->>\'unsurveilled\') IS DISTINCT FROM \'true\' LIMIT 1')).rows[0]?.id;
  // witnessRoll returns the witness SOURCE ('camera' | 'cop' | 'always' | false).
  check('witnessRoll honors a forced always-witness in a normal zone', (await witnessRoll(anyZone, 'always', false, 0)) === 'always', anyZone);
  const bunker = getZone('zone_lw_commons');
  check('bunker zone carries the unsurveilled flag', bunker?.flags?.unsurveilled === true, JSON.stringify(bunker?.flags)?.slice(0, 90));
  check('unsurveilled zone: even an always-witness is unseen', (await witnessRoll('zone_lw_commons', 'always', false, 0)) === false);
  check('unsurveilled zone: isWitnessed is false', (await isWitnessed('zone_lw_commons')) === false);
  // A `camera`-witnessed crime is caught by a lens or not at all — no cop eyeball,
  // no bystander, whoever is standing there. (`any` also accepts an on-scene cop,
  // so it isn't deterministic here and isn't asserted.)
  check('no camera, no witness (camera-only crime)', (await witnessRoll(anyZone, 'camera', false, 1)) === false, anyZone);
  // camChance 100 so the visibility scalar (never below 0.1×) can't make this flaky.
  check('a live camera at full odds does witness', (await witnessRoll(anyZone, 'any', true, 100)) === 'camera', anyZone);

  // Camera odds scale with the crime's own star weight around a 2-star pivot, so a
  // lens takes far longer to file public nudity than it does a mugging.
  check('sevFactor: a 2-star crime rolls at face value', sevFactor('burglary') === 1, sevFactor('burglary'));
  check('sevFactor: petty crime is floored, not free', sevFactor('indecent_exposure') === 0.25, sevFactor('indecent_exposure'));
  check('sevFactor: violent crime out-rolls petty crime', sevFactor('arson') > sevFactor('graffiti'));
  check('sevFactor: unknown key never breaks the roll', sevFactor('not_a_crime') === 1);

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
     VALUES ('item_specter_program','SPECTER Install Chip','','device',100,1500,'{"specter_program":true}')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, tags=EXCLUDED.tags`
  );
  await reloadItem('item_specter_program');
  await query("DELETE FROM player_inventory WHERE player_id=$1 AND item_id='item_specter_program'", [p.id]);
  await query(
    "INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ('inv_regress_specter',$1,'item_specter_program',1)",
    [p.id]
  );
  const inst = await run('use SPECTER Install Chip');
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

  __captureZoneLine(CAM_ZONE, { type: 'say', message: 'Kaz says, "meet me at the docks"' });
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
  await deleteFurniture(CAM_ID);
  await insertFurniture({
    id: CAM_ID, zone_id: CAM_ZONE, name: 'Regress Cam', description: '',
    object_type: 'security_device',
    flags: JSON.stringify({ security_device: true, device_id: CAM_ID, concealed: true }),
    origin: 'player', owner_id: p.id,
  });
  await query('DELETE FROM security_clips WHERE owner_id=$1', [p.id]);
  await query("DELETE FROM player_inventory pi USING items i WHERE pi.item_id=i.id AND pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')", [p.id]);
  const clipRes = await run('clip Regress Cam');
  check('clip saves a microreel + mints its datachip', clipRes?.type === 'output' && /microreel/i.test(clipRes?.message || ''), JSON.stringify(clipRes)?.slice(0, 160));
  check('clip clears the buffer so the cam records again', __cameraFrames(CAM_ID).length === 0 && __cameraFull(CAM_ID) === false, `len=${__cameraFrames(CAM_ID).length} full=${__cameraFull(CAM_ID)}`);
  const reels = await microreelList(p);
  check('clipped microreel appears in the carried reel list', reels.length >= 1 && reels[0].frames === 25, JSON.stringify(reels[0])?.slice(0, 160));
  const { rows: chipItems } = await query("SELECT 1 FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'datachip')", [p.id]);
  check('clipping mints exactly one physical datachip (the reel is the chip)', chipItems.length === 1, `chips=${chipItems.length}`);

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

  // ── Self-destruct + the 24h sticky-cam burnout ──────────────────────────────
  // The fixture cam is still planted (device + furniture rows) with placed_at=0,
  // i.e. long past the TTL. First: a non-owner can't blow it.
  const notMineKill = await selfDestructDevice({ id: 'someone_else', current_zone: CAM_ZONE }, CAM_ID);
  check('selfDestructDevice refuses a non-owner', notMineKill?.ok === false, JSON.stringify(notMineKill));
  const killed = await selfDestructDevice(p, CAM_ID);
  check('selfDestructDevice kills the owner device', killed?.ok === true, JSON.stringify(killed));
  const { rows: afterKill } = await query('SELECT 1 FROM security_devices WHERE id=$1', [CAM_ID]);
  const { rows: furnAfterKill } = await query('SELECT 1 FROM furniture WHERE id=$1', [CAM_ID]);
  check('self-destruct removes both device and furniture rows', afterKill.length === 0 && furnAfterKill.length === 0,
    `dev=${afterKill.length} furn=${furnAfterKill.length}`);

  // Two fresh cams straddling the TTL. The window is 24 GAME hours, so the real-time
  // boundary is 24h / timeScale — pinning the fixtures to real hours would silently
  // stop testing the boundary the moment someone changed the world clock.
  const scale = getTimeScale();
  const ttl = __stickyCamTtl();
  const ttlRealH = ttl.realMs / 3600000;
  check('the sticky-cam window is 24 GAME hours', ttl.gameMs === 24 * 3600 * 1000, `${ttl.gameMs}ms`);
  check('…which is 24/timeScale REAL hours, not a flat 24',
    Math.abs(ttlRealH - 24 / scale) < 1e-6, `scale=${scale} → ${ttlRealH.toFixed(2)}h real`);
  const OLD_ID = 'secdev_regress_old', NEW_ID = 'secdev_regress_new';
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [id, placed] of [
    [OLD_ID, nowSec - Math.ceil((ttlRealH + 1) * 3600)],   // an hour past the window
    [NEW_ID, nowSec - Math.floor((ttlRealH / 2) * 3600)],  // halfway through it
  ]) {
    await query('DELETE FROM security_devices WHERE id=$1', [id]);
    await deleteFurniture(id);
    await query(
      `INSERT INTO security_devices (id, owner_id, device_kind, zone_id, direction, tier,
         concealment, battery, battery_max, wired, is_damaged, is_recording, hack_difficulty, placed_at)
       VALUES ($1,$2,'sticky_cam',$3,'north',1,5,100,864,0,0,0,5,$4)`, [id, p.id, CAM_ZONE, placed]);
    await insertFurniture({
      id, zone_id: CAM_ZONE, name: 'Regress TTL Cam', description: '',
      object_type: 'security_device',
      flags: JSON.stringify({ security_device: true, device_id: id, concealed: true }),
      origin: 'player', owner_id: p.id,
    });
  }
  await __expireStickyCams();
  const { rows: live } = await query('SELECT id FROM security_devices WHERE id = ANY($1::text[])', [[OLD_ID, NEW_ID]]);
  check('sticky cam past 24 game-hours is auto-destroyed', !live.some(r => r.id === OLD_ID), JSON.stringify(live));
  check('sticky cam inside 24 game-hours survives the sweep', live.some(r => r.id === NEW_ID), JSON.stringify(live));
  const { rows: oldFurn } = await query('SELECT 1 FROM furniture WHERE id=$1', [OLD_ID]);
  check('burnout takes the furniture row with it', oldFurn.length === 0, `furn=${oldFurn.length}`);

  await query('DELETE FROM security_devices WHERE id = ANY($1::text[])', [[OLD_ID, NEW_ID]]);
  await deleteFurniture(OLD_ID);
  await deleteFurniture(NEW_ID);
  await deleteFurniture(CAM_ID);
  await query('DELETE FROM security_devices WHERE id=$1', [CAM_ID]);

  // ── Your own network, by typing ────────────────────────────────────────────
  // deleteMicroreel / selfDestructDevice / patchCamToDeck were each called from
  // exactly one SPECTER-app button, so scuttling a device or destroying a reel
  // was impossible without a tablet. The two destructive ones are TWO-STEP: with
  // no focused tile to disambiguate, the confirmation IS the disambiguation.
  {
    let x = await run('devices');
    check('devices lists your own network rather than erroring', x?.type === 'output', JSON.stringify(x)?.slice(0, 140));

    x = await run('destruct');
    check('destruct with no target asks which, and points at devices',
      x?.type === 'error' && /devices/i.test(x.message || ''), JSON.stringify(x)?.slice(0, 160));
    x = await run('destruct nothing_of_that_name');
    check('destruct on an unowned device is refused', x?.type === 'error', JSON.stringify(x)?.slice(0, 140));
    check('...and never claims to have destroyed it', !/gone|smoke/i.test(x?.message || ''), x?.message);

    x = await run('crush');
    check('crush with no chip is refused', x?.type === 'error', JSON.stringify(x)?.slice(0, 140));
    x = await run('crush nothing_of_that_name');
    check('crush on a chip you do not carry is refused', x?.type === 'error', JSON.stringify(x)?.slice(0, 140));
    check('...and never claims to have destroyed it', !/isn't anywhere/i.test(x?.message || ''), x?.message);

    x = await run('cast');
    check('cast with no camera asks which', x?.type === 'error', JSON.stringify(x)?.slice(0, 140));
  }

  // ── The hub, written out (bottom Display Mode rung) ────────────────────────
  // A SNAPSHOT, not a stream. The panel is fed by a 5-second tick; pushing that to
  // a log would be twelve near-identical readouts a minute, forever — exactly what
  // the pacing rule forbids. So `hub` prints once and registers no viewer.
  {
    const { _test: surv } = await import('./index.js');
    const payload = {
      net: { name: 'SPECTER // OPERATOR' },
      alerts: [{ t: 1, text: 'Motion in the stairwell', zone: 'z1' }],
      tiles: [
        { id: 'a', name: 'stairwell cam', zone: 'Stairwell', status: 'ok', battery: 82,
          recording: true, full: false, bufferLines: 4, frame: 'A figure crosses left to right.', expiresIn: 1380 },
        { id: 'b', name: 'alley cam', zone: 'Back Alley', status: 'jammed', battery: 12,
          recording: false, full: false, bufferLines: 0, frame: null, expiresIn: null },
      ],
    };
    const t = surv.renderHubText(payload);

    check('hub text: names the network', /SPECTER/.test(t), t.slice(0, 60));
    check('hub text: surfaces alerts', /Motion in the stairwell/.test(t), t);
    check('hub text: lists every device', /stairwell cam/.test(t) && /alley cam/.test(t));
    check('hub text: carries status and battery', /OK/.test(t) && /82%/.test(t), t);
    check('hub text: a jammed device reads as jammed, not merely absent', /JAMMED/.test(t), t);
    check('hub text: shows what is recording and how much is on tape',
      /REC/.test(t) && /4 on tape/.test(t), t);
    // THE FRAME IS THE FEED. Without it this is an inventory list, not surveillance.
    check('hub text: includes the live frame — otherwise it is not a feed at all',
      /A figure crosses left to right/.test(t), t);
    check('hub text: offers the way to refresh, since there is no live stream',
      /hub to refresh/.test(t), t);

    const empty = surv.renderHubText({ net: { name: 'SPECTER' }, alerts: [], tiles: [] });
    check('hub text: an empty network says so and points at plant',
      /No devices/.test(empty) && /plant/.test(empty), empty);
  }
}
