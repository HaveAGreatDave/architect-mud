// Prologue plugin regression suite — run by tests/regress.js (never in production).
import { query } from '../../server/models/db.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { clearFlag } from '../../server/engine/flags.js';
import { getNetXp } from '../../server/engine/ip.js';
import { availableActions } from '../../server/engine/specializedActions.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { _test } from './index.js';

export default async function regress({ check }) {
  const {
    prologueMoveGate, useHolosign, useHolocaster, readHolosign,
    Z_INBETWEEN, Z_LATTICE, Z_BROADCAST,
    ITEM_HOLOCASTER,
    F_ALIGNED, F_INTERFACED, F_BROADCAST,
    cmdTutorial, F_TOUR_ASKED, F_TOUR_TAKEN, isSet,
    coldwaterSkyline, coldwaterShore, readTwocellAdvert, Z_CLONEVAT,
    cmdTabletDone, pointAtAdvert, F_ADVERT,
    LOG_TOUR, LOG_TABLET_TOUR,
  } = _test;

  // ── The cold open's skyline manifest ───────────────────────────────────────
  // The closing flythrough renders the REAL city, so this is the one thing in
  // the cinematic that can break from a content edit rather than a code one:
  // rename a building_type, move a tile out of region_coldwater, and the cold
  // open quietly loses a tower. Assert the shape and that it's actually
  // Coldwater — a manifest that silently comes back empty would fall through to
  // the client's procedural stand-in and nobody would ever notice.
  const sky = coldwaterSkyline();
  check('skyline manifest is a non-empty array', Array.isArray(sky) && sky.length > 20, `n=${sky?.length}`);
  check('skyline entries are {x,y,t,f}', sky.every(b =>
    Number.isFinite(b.x) && Number.isFinite(b.y) && typeof b.t === 'string' && Number.isFinite(b.f)));
  check('skyline is Coldwater, not The Reach', sky.every(b => b.y <= 960));
  // `n` (building name) and `e` (entrance) are what let the cold open draw a building's REAL shape
  // rather than a box — the name resolves a landmark to its own model, the entrance is the frame
  // that model's geometry is laid out in. Both are optional per entry (plenty of tiles are a plain
  // typed building with no name), so assert the TYPES when present and that the city as a whole
  // still carries them: a rename or a lost `facade` tag that emptied either one would silently
  // downgrade every landmark in the flythrough back to a generic box.
  check('skyline n/e are well-formed when present', sky.every(b =>
    (b.n === undefined || (typeof b.n === 'string' && b.n.length > 0))
    && (b.e === undefined || ['north', 'south', 'east', 'west'].includes(b.e))));
  check('skyline still carries named landmarks', sky.filter(b => b.n).length > 5, `named=${sky.filter(b => b.n).length}`);
  check('skyline still carries entrances', sky.filter(b => b.e).length > 5, `withEntrance=${sky.filter(b => b.e).length}`);
  check('skyline is cached (same array identity)', coldwaterSkyline() === sky);

  // The coastline the flythrough traces. Same failure mode as the skyline: a
  // terrain repaint that stopped water meeting land would empty this and the
  // cold open would just quietly lose its shore.
  const shore = coldwaterShore();
  check('shore manifest is a non-empty array', Array.isArray(shore) && shore.length > 20, `n=${shore?.length}`);
  check('shore runs are [x,y,dir,len]', shore.every(r =>
    r.length === 4 && r.every(Number.isFinite) && (r[2] === 0 || r[2] === 1) && r[3] > 0));
  check('shore is cached (same array identity)', coldwaterShore() === shore);


  // The stat gift + holocaster grant write player-scoped rows (FKs to players),
  // so this needs a REAL players row — the harness's shared player is in-memory
  // only. Make a throwaway with a known XP budget so the "off the books" check
  // is meaningful.
  const p = { id: `prologue_regress_${process.pid}`, handle: `PrologueRegress${process.pid}` };
  const cleanup = async () => {
    await query('DELETE FROM player_inventory WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM player_skills WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [p.id]).catch(() => {});
  };
  const flags = [F_ALIGNED, F_INTERFACED, F_BROADCAST, 'prologue_collapse_open', 'prologue_broadcast_played'];
  await cleanup();
  await query(
    'INSERT INTO players (id, username, handle, password_hash, bonus_xp) VALUES ($1,$2,$3,$4,1800)',
    [p.id, p.id, p.handle, 'x']
  );

  // ── Move gate is wired ─────────────────────────────────────────────────────
  check('prologue move gate registered', getRegisteredMoveGates().includes('prologue'));

  // ── The clone-vat advert ───────────────────────────────────────────────────
  // `read` is a global verb (bulletins, job boards), so the two things that
  // matter are that this handler stays out of everyone else's way and that the
  // destination it offers still exists. The zone NAME is what `gps` resolves
  // against — rename that tile and the "show me the way" link silently 404s.
  const advertElsewhere = await readTwocellAdvert(['advert'], 'read advert', { ...p, current_zone: Z_LATTICE });
  check('read advert is inert outside the clone vat', advertElsewhere === undefined);
  const advertOther = await readTwocellAdvert(['bulletin'], 'read bulletin', { ...p, current_zone: Z_CLONEVAT });
  check('read <not the advert> falls through', advertOther === undefined);
  const twocell = await query(`SELECT name FROM zones WHERE id='zone_district_920_903'`);
  check('the advert has somewhere to send you', twocell.rows[0]?.name === 'Two-Cell Supply', twocell.rows[0]?.name);

  // ── The poster beat waits for the tablet walkthrough ───────────────────────
  // The nudge used to fire on a timer; it now fires when the client says the
  // tablet tutorial is over (`tabletdone`) or when the server's own backstop
  // gives up. Two things must hold: it happens EXACTLY ONCE (it raises a flag,
  // and a doubled nudge is two shimmering posters and a repeated paragraph), and
  // it never fires anywhere but the vat — `tabletdone` is a replayable client
  // echo, so a veteran replaying `tutorial tablet` in a bar must get nothing.
  await clearFlag('player', F_ADVERT, p);
  await cmdTabletDone([], 'tabletdone', { ...p, current_zone: Z_LATTICE });
  check('tabletdone outside the vat leaves the poster beat unspent', !(await isSet(p, F_ADVERT)));
  await cmdTabletDone([], 'tabletdone', { ...p, current_zone: Z_CLONEVAT });
  check('tabletdone in the vat spends the poster beat', await isSet(p, F_ADVERT));
  await pointAtAdvert({ ...p, current_zone: Z_CLONEVAT });
  check('the poster beat is once-only', await isSet(p, F_ADVERT));   // flag-guarded; no throw, no re-send
  await clearFlag('player', F_ADVERT, p);

  // ── No tablet in the corridor ─────────────────────────────────────────────
  // The device is issued at the vat, so every door into the shell has to refuse
  // while you're in a prologue-flagged room — including `tabletnav`, which is
  // what `codex`/`map`/`gear` and the client's own nav all come through.
  {
    const { commands: tabletCmds } = await import('../tablet/index.js');
    const inCorridor = { ...p, current_zone: Z_INBETWEEN };
    const t1 = await tabletCmds.tablet([], 'tablet', inCorridor);
    check('tablet refused in the prologue corridor', t1?.type === 'system' && /no tablet/i.test(t1.message || ''), JSON.stringify(t1)?.slice(0, 80));
    const t2 = await tabletCmds.tabletnav(['codex'], 'codex', inCorridor);
    check('tabletnav refused in the prologue corridor too', t2?.type === 'system' && /no tablet/i.test(t2.message || ''), JSON.stringify(t2)?.slice(0, 80));
    const t3 = await tabletCmds.tablet([], 'tablet', { ...p, current_zone: Z_CLONEVAT });
    check('…and opens normally the moment you are out of it', t3?.type === 'tablet_panel', JSON.stringify(t3)?.slice(0, 60));
  }

  // ── Gate 1: north out of The Inbetween (→ The Lattice) needs alignment ──────
  const g1blocked = await prologueMoveGate({ player: { ...p, current_zone: Z_INBETWEEN }, to: { id: Z_LATTICE } });
  check('inbetween→lattice blocked before alignment', g1blocked?.block === true, JSON.stringify(g1blocked)?.slice(0, 60));

  // ── The holosign self-gates outside the lattice ────────────────────────────
  const wrongZone = await useHolosign(['holosign'], 'use holosign', { ...p, current_zone: Z_INBETWEEN });
  check('use holosign is inert outside the lattice', wrongZone === undefined);

  // ── `read holosign` is an alias for examining it ───────────────────────────
  // Scoped to the lattice and to the holosign: the global `read` verb still
  // belongs to bulletins and job boards, so both of those must fall through.
  const readWrongZone = await readHolosign(['holosign'], 'read holosign', { ...p, current_zone: Z_INBETWEEN });
  check('read holosign is inert outside the lattice', readWrongZone === undefined);
  const readOther = await readHolosign(['board'], 'read board', { ...p, current_zone: Z_LATTICE });
  check('read <not the holosign> falls through', readOther === undefined);
  const readIt = await readHolosign(['holosign'], 'read holosign', { ...p, current_zone: Z_LATTICE });
  check('read holosign answers like examine', readIt !== undefined && readIt?.type !== 'error', readIt?.type);
  const readCaster = await readHolosign(['holocaster'], 'read holocaster', { ...p, current_zone: Z_LATTICE });
  check('read holocaster is not swallowed by the holosign', readCaster === undefined);
  // …but it must NOT advertise itself. `read` is registered ungated precisely so
  // the reverse lookup can't offer it on the sign's room link as a second door —
  // examine is the one door, and USE is what you click from there.
  const signActions = availableActions({ flags: { prologue_holosign: true } });
  check('read is not advertised on the holosign', !signActions.includes('read'), signActions.join(','));
  check('use IS advertised on the holosign', signActions.includes('use'), signActions.join(','));

  // ── The attendant's dialogue drives the first two beacons ──────────────────
  // Authored flat on the nodes, so this is really a check that the content and
  // the action agree — the failure mode is a silent no-op in front of a new
  // player, which nothing else would catch.
  const fakeActor = { id: p.id, _prologueBeacons: [] };
  const seenSet = () => (fakeActor._prologueBeacons || []).map(b => b.join(' '));
  const talkNode = await dispatchAction({ type: 'PROLOGUE_BEACON', actor: fakeActor, params: { at: 'none' } });
  check('PROLOGUE_BEACON none is accepted', talkNode?.type !== 'error', talkNode?.message);
  check('talking to the attendant leaves nothing lit', seenSet().length === 0, seenSet().join('|'));
  const descNode = await dispatchAction({ type: 'PROLOGUE_BEACON', actor: fakeActor, params: { at: 'terminal' } });
  check('PROLOGUE_BEACON terminal is accepted', descNode?.type !== 'error', descNode?.message);
  check('the describe line lights the terminal, alone', seenSet().length === 1 && seenSet()[0].includes('MORPHEX'), seenSet().join('|'));
  const bogus = await dispatchAction({ type: 'PROLOGUE_BEACON', actor: fakeActor, params: { at: 'nowhere' } });
  check('PROLOGUE_BEACON rejects an unknown target', bogus?.type === 'error');

  // The attendant's tree actually carries those actions (content, not code).
  const att = await query(`SELECT dialogue_tree FROM npcs WHERE id='npc_attendant_inbetween'`);
  const tree = att.rows[0]?.dialogue_tree || {};
  const actionAt = (node) => (tree[node]?.actions || []).find(a => a.action === 'PROLOGUE_BEACON')?.at;
  check('attendant root clears the beacon', actionAt('root') === 'none', actionAt('root'));
  check('attendant describe lights the terminal', actionAt('describe') === 'terminal', actionAt('describe'));

  // ── The gift beat: +1 to every stat (free of XP) + the holocaster ──────────
  const netBefore = await getNetXp(p.id);
  const lp = { ...p, current_zone: Z_LATTICE };
  // Drive it with the bare "holo" to prove that abbreviation matches the holosign
  // (and is not swallowed by the holocaster's handler).
  const interfaced = await useHolosign(['holo'], 'use holo', lp);
  check('use holo (abbrev) matches the holosign', interfaced?.type === 'emote', interfaced?.type);

  const g = await query(
    'SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses, gifted_stat_points FROM players WHERE id=$1',
    [p.id]
  );
  const row = g.rows[0];
  check('every stat raised by 1', ['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses'].every(s => row[`stat_${s}`] === 1), JSON.stringify(row));
  check('six gifted stat points recorded', row.gifted_stat_points === 6, row.gifted_stat_points);

  // The stat gift is off the XP books; the only XP delta is the +1 Architect
  // Interface IP the touch legitimately earns (real skill practice IS XP).
  const netAfter = await getNetXp(p.id);
  check('stat gift is off the books; only +1 IP moves Net XP', netAfter.net === netBefore.net + 1 && netAfter.net === 1801, `${netBefore.net}→${netAfter.net}`);
  check('stat gift is off the books; only +1 IP moves Total XP', netAfter.total === 1801, netAfter.total);

  const inv = await query('SELECT item_id FROM player_inventory WHERE player_id=$1', [p.id]);
  check('holocaster granted', inv.rows.some(r => r.item_id === ITEM_HOLOCASTER));
  check('no tablet granted (removed)', !inv.rows.some(r => r.item_id === 'item_prologue_tablet'));

  // The interface gift also teaches its own skill: a first point of Architect Interface IP.
  const sk = await query('SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id=$2', [p.id, 'architect_interface']);
  check('architect interface IP granted (1)', sk.rows[0]?.ip === 1, JSON.stringify(sk.rows[0]));

  // Second touch is inert — no double gift.
  const again = await useHolosign(['holosign'], 'use holosign', lp);
  check('second holosign touch is a flavour no-op', again?.type === 'emote');
  const g2 = await query('SELECT stat_brawn, gifted_stat_points FROM players WHERE id=$1', [p.id]);
  check('holosign does not re-gift stats', g2.rows[0].stat_brawn === 1 && g2.rows[0].gifted_stat_points === 6, JSON.stringify(g2.rows[0]));

  // ── Broadcast door was shut; the holocaster opens it and is consumed ───────
  const g2blocked = await prologueMoveGate({ player: { ...p, current_zone: Z_LATTICE }, to: { id: Z_BROADCAST } });
  check('lattice→broadcast blocked before the holocaster', g2blocked?.block === true);

  const used = await useHolocaster(['holocaster'], 'use holocaster', lp);
  check('use holocaster returns an emote', used?.type === 'emote', used?.type);
  const gone = await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, ITEM_HOLOCASTER]);
  check('holocaster is consumed on use', gone.rows.length === 0);
  const g2open = await prologueMoveGate({ player: { ...p, current_zone: Z_LATTICE }, to: { id: Z_BROADCAST } });
  check('lattice→broadcast opens after holocaster', g2open === undefined);

  // holocaster with none carried falls through to the builtin.
  const noItem = await useHolocaster(['holocaster'], 'use holocaster', lp);
  check('use holocaster without one falls through', noItem === undefined);

  // ── The vat's naked window ─────────────────────────────────────────────────
  // A first clone is bare from the moment it hits the floor until the gantry
  // dresses it, and the surveillance scan runs on its own tick — so both
  // emergence paths hold `_vatDressing` across that gap. The contract the fix
  // rests on is that equipStarterOutfit is AWAITABLE (its inserts are otherwise
  // fire-and-forget, and clearing the window on return reopens the race) and
  // that there's a grace period after it. Assert both: a future refactor that
  // drops the return value would silently reintroduce booking a brand-new
  // player for indecent exposure while a machine dresses them.
  const gl = await import('../../server/engine/gameLoop.js');
  check('equipStarterOutfit is awaitable', typeof gl.equipStarterOutfit(p.id, 'male')?.then === 'function');
  check('a dress grace window exists', Number(gl.VAT_DRESS_GRACE_MS) > 0, gl.VAT_DRESS_GRACE_MS);
  await query('DELETE FROM player_inventory WHERE player_id=$1', [p.id]).catch(() => {});

  // ── The interface tour: the answer is remembered, the replay is silent ─────
  const declined = await cmdTutorial(['no'], 'tutorial no', p);
  check('tutorial no answers with a hint', declined?.type === 'system');
  check('tutorial no marks the question asked', await isSet(p, F_TOUR_ASKED));
  check('tutorial no does not mark the tour taken', !(await isSet(p, F_TOUR_TAKEN)));
  const accepted = await cmdTutorial(['yes'], 'tutorial yes', p);
  check('tutorial yes is silent (the client is already touring)', accepted === null);
  const replay = await cmdTutorial([], 'tutorial', p);
  check('bare tutorial replays silently', replay === null);
  const done = await cmdTutorial(['done'], 'tutorial done', p);
  check('tutorial done closes it out', done?.type === 'system' && (await isSet(p, F_TOUR_TAKEN)));
  flags.push(F_TOUR_ASKED, F_TOUR_TAKEN);

  // ── The spoken tour (the `log` rung) ───────────────────────────────────────
  // The whole point of this walkthrough is that it tells a player who cannot see
  // the room pane that `look` gets them the full description a move does not —
  // so that line existing is the assertion, not a nicety.
  const tourText = [...LOG_TOUR, ...LOG_TABLET_TOUR].join(' ');
  check('the spoken tour teaches `look`', /data-cmd="look"/.test(tourText));
  check('the spoken tour teaches the way back out', /data-cmd="displaymode visual"/.test(tourText));
  check('the spoken tour teaches the typed tablet index', /data-cmd="tablet verbs"/.test(tourText));
  // Every command it hands the player is a command they could have typed — the
  // same rule the workspace HUD is held to. A card offering a dead verb is worse
  // than no card, because this player has no panel to fall back on.
  const { getRegisteredCommands } = await import('../../server/engine/plugins.js');
  const { builtinCommandNames } = await import('../../server/engine/commands/index.js');
  const verbs = new Set([...getRegisteredCommands(), ...builtinCommandNames()]);
  const offered = [...tourText.matchAll(/data-cmd="([^"]+)"/g)].map(m => m[1].split(' ')[0]);
  const dead = offered.filter(v => !verbs.has(v));
  check('every verb the spoken tour offers is registered', dead.length === 0, dead.join(', '));

  // At the bottom rung the tour is OURS to speak: `tutorial` must not hand off to
  // a client walkthrough that spotlights panels this player never receives.
  p.displayRung = 'log';
  check('tutorial at the log rung stays silent (spoken, not pushed)', (await cmdTutorial([], 'tutorial', p)) === null);
  check('tutorial tablet at the log rung stays silent', (await cmdTutorial(['tablet'], 'tutorial tablet', p)) === null);
  p.displayRung = undefined;

  // ── Cleanup ────────────────────────────────────────────────────────────────
  for (const f of flags) await clearFlag('player', f, p).catch(() => {});
  await cleanup();
}
