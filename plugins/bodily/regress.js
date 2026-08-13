// Bodily plugin regression suite — run by tests/regress.js (never loaded in
// production). Only exercises the gated no-mutation paths: a real relief would
// stain the actual zone the fake player stands in.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedThirst = p.thirst, savedHunger = p.hunger;

  p.thirst = 0;
  let r = await run('pee');
  check('pee verb routed + dehydration gate', /too dehydrated/.test(r?.message || ''), r?.message);

  p.hunger = 0;
  r = await run('poop');
  check('poop verb routed + empty-stomach gate', /haven't eaten/.test(r?.message || ''), r?.message);

  p.thirst = savedThirst; p.hunger = savedHunger;

  r = await run('pee on nobodyhere');
  check('bodily target miss reports not-found', /don't see/i.test(r?.message || ''), r?.message);

  r = await run('flush');
  check('flush verb routed', /flush|no toilet/i.test(r?.message || ''), r?.message);

  r = await run('shower');
  check('shower verb routed + no-shower gate', /no shower here/i.test(r?.message || ''), r?.message);

  // Shower recognised the same three ways as a toilet (type / flag / name).
  const { isShower } = await import('./index.js');
  check('object_type shower recognised', isShower({ name: 'jet', object_type: 'shower', flags: {} }) === true);
  check('name-only shower recognised', isShower({ name: 'rain shower head', object_type: 'fixture', flags: {} }) === true);
  check('flag shower recognised', isShower({ name: 'stall', object_type: 'fixture', flags: { shower: true } }) === true);
  check('non-shower furniture ignored', isShower({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // A toilet is recognised by name, not just object_type/flags — content
  // routinely types toilets as 'furniture'/'fixture'. Without this, relief,
  // flush, and the fouled/peed describe line all silently miss them.
  const { isToilet } = await import('./index.js');
  check('name-only toilet recognised', isToilet({ name: 'curtained toilet', object_type: 'fixture', flags: {} }) === true);
  check('object_type toilet recognised', isToilet({ name: 'steel bowl', object_type: 'toilet', flags: {} }) === true);
  check('non-toilet furniture ignored', isToilet({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // ── The room only hears a bowl when there is one ────────────────────────────
  // Half the fart pool was written with porcelain under it and then played over
  // every other target: a man squatting in an alley was told his fart echoed off
  // the bowl, and the street was told the noise came from "the toilet nearby".
  // The split is only worth anything if the general pool stays clean, so assert
  // that rather than trusting it — this is the check that catches the next line
  // somebody writes while picturing a bathroom.
  {
    const { _test: bodilyTest } = await import('./index.js');
    const porcelain = /\b(bowl|toilet|cistern|porcelain|seat)\b/i;
    const dirty = bodilyTest.FART_LINES.filter(l => porcelain.test(l.self) || porcelain.test(l.zone));
    check('fart: the general pool names no plumbing',
      dirty.length === 0, dirty.map(l => l.self).join(' | ') || 'clean');
    check('fart: the toilet pool exists and is about the toilet',
      bodilyTest.FART_LINES_TOILET.length > 0
        && bodilyTest.FART_LINES_TOILET.every(l => porcelain.test(l.self) || porcelain.test(l.zone)),
      `${bodilyTest.FART_LINES_TOILET.length} line(s)`);
  }

  // Contaminated-water seam: the water + fillable plugins ask over these actions.
  const { dispatchAction } = await import('../../server/engine/actions.js');
  const clean = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'no-such-toilet' } });
  check('unfouled toilet reports clean', clean.fouled === false && clean.peed === false, JSON.stringify(clean));

  p.statuses = [];
  const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: p, params: { fouled: true } });
  check('drinking foul water returns a warning line', /fouled|regret|gag/i.test(foul.message || ''), foul.message);
  check('drinking foul water applies the sick effect', (p.statuses || []).some(s => s.name === 'sick'));
  p.statuses = [];

  // Flush clears the filth: foul a toilet (both pee + poo), confirm it reports
  // contaminated, clear it the way flush does, confirm contamination is gone.
  const { foulToilet, clearToiletFilth } = await import('./index.js');
  foulToilet('regress-bowl', 'poop');
  foulToilet('regress-bowl', 'pee');
  let s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('fouled toilet reports contaminated', s.fouled === true && s.peed === true, JSON.stringify(s));
  clearToiletFilth('regress-bowl');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('flush clears pee, poo, and contamination', s.fouled === false && s.peed === false, JSON.stringify(s));

  // ── Scooping a fouled toilet ────────────────────────────────────────────────
  // The whole feature rests on the filth already being an ITEM, so the first
  // thing to assert is that the item it hands you is a real row — a broken id
  // here would fail silently at the INSERT and leave the player empty-handed
  // with shit on their hands for nothing.
  const { FILTH_ITEMS, clearBodyStain } = await import('../../server/engine/bodily.js');
  const { query: q2 } = await import('../../server/models/db.js');
  check('feces maps to a real item row', FILTH_ITEMS.feces === 'item_vessel_filth');
  const { rows: filthRows } = await q2(`SELECT tags FROM items WHERE id=$1`, [FILTH_ITEMS.feces]);
  check('...and that item exists in content', filthRows.length === 1);
  check('...tagged so cooking and the containers already know it',
    !!filthRows[0]?.tags?.bodily_filth && !!filthRows[0]?.tags?.food_profile);

  // Scooping is NOT flushing. Taking the solid out removes the mass and leaves
  // the water exactly as foul as it was — so the contamination query must keep
  // answering `fouled`, because water/fillable ask it "is this safe to drink"
  // and the answer did not change. Only a flush moves water.
  const { scoopToilet } = await import('./index.js');
  foulToilet('regress-scooped', 'poop');
  scoopToilet('regress-scooped');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-scooped' } });
  check('a scooped bowl still contaminates its water', s.fouled === true, JSON.stringify(s));
  clearToiletFilth('regress-scooped');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-scooped' } });
  check('...and only a flush clears it', s.fouled === false, JSON.stringify(s));
  // Scooping must not take the piss with it — they are separate deposits.
  foulToilet('regress-both', 'poop');
  foulToilet('regress-both', 'pee');
  scoopToilet('regress-both');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-both' } });
  check('scooping the solid leaves the piss alone', s.peed === true, JSON.stringify(s));
  clearToiletFilth('regress-both');

  // ── A bowl fills up, and then it stops coping ────────────────────────────────
  // The threshold is the entire teaching mechanism for `flush`, so it is asserted
  // rather than trusted: five deposits overflow, four do not, and it never
  // quietly repairs itself.
  const { TOILET_CAPACITY, sweepToilets } = await import('./index.js');
  clearToiletFilth('regress-fill');
  let last = null;
  for (let i = 1; i < TOILET_CAPACITY; i++) last = foulToilet('regress-fill', 'poop', 'zone_regress_public');
  check('a bowl takes several visits before it gives up', last.overflowed === false && last.count === TOILET_CAPACITY - 1, JSON.stringify(last));
  last = foulToilet('regress-fill', 'poop', 'zone_regress_public');
  check('...and overflows on the one that fills it', last.overflowed === true, JSON.stringify(last));
  last = foulToilet('regress-fill', 'poop', 'zone_regress_public');
  check('...and keeps overflowing — it does not fix itself', last.overflowed === true, JSON.stringify(last));

  // Bailing it out by hand is a real (grim) answer: each scoop is one deposit
  // and one `measure of filth` you now have to deal with.
  const scooped = scoopToilet('regress-fill');
  check('scooping takes one deposit, not the lot', scooped.count === TOILET_CAPACITY, JSON.stringify(scooped));
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-fill' } });
  check('...and a bailed bowl is still foul water', s.fouled === true);

  // ── The nightly sweep ────────────────────────────────────────────────────────
  // Same cadence zones.stains runs on: the city cleans itself, your bathroom is
  // your problem. Read off the engine's `deepClean` flag rather than re-derived,
  // so the two can never drift.
  const { registerOwnedZoneProvider } = await import('../../server/engine/zone-filth.js');
  registerOwnedZoneProvider(z => (z === 'zone_regress_owned' ? 'regress-owner' : false));

  clearToiletFilth('regress-fill');
  foulToilet('regress-public', 'poop', 'zone_regress_public');
  foulToilet('regress-owned',  'poop', 'zone_regress_owned');
  let swept = sweepToilets({ deepClean: false });
  check('the nightly sweep flushes an unowned toilet', swept.cleared === 1, JSON.stringify(swept));
  check('...and leaves the one in a room somebody owns', swept.spared === 1, JSON.stringify(swept));
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-public' } });
  check('...so the public bowl really is clean', s.fouled === false && s.peed === false, JSON.stringify(s));
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-owned' } });
  check('...and the owned one really is not', s.fouled === true, JSON.stringify(s));

  // The absentee backstop: on the deep-clean day even an owned bowl goes.
  swept = sweepToilets({ deepClean: true });
  check('the deep-clean day takes the owned one too', swept.cleared === 1 && swept.spared === 0, JSON.stringify(swept));

  // A bowl fouled with no zone recorded can't belong to anybody, so it must
  // never be spared — that would leak state forever.
  foulToilet('regress-orphan', 'poop');
  swept = sweepToilets({ deepClean: false });
  check('a toilet with no room recorded is never spared', swept.cleared === 1 && swept.spared === 0, JSON.stringify(swept));

  // Stateless by construction: the engine derives the day, and the sweep only
  // ever reads the flag it is handed. Nothing here persists across a restart,
  // which is the property that stops a reboot handing everyone a clean slate
  // ON A DIFFERENT SCHEDULE than the stains they were tracking.
  const { isDeepCleanDay, STAIN_KEEP_DAYS } = await import('../../server/engine/zone-filth.js');
  check('the toilet sweep rides the same stateless cadence as stains',
    typeof isDeepCleanDay('2026-08-01') === 'boolean' && STAIN_KEEP_DAYS === 7);

  // Interception is self-gating: no toilet in the room means `take shit` is not
  // this feature's business and must reach the ordinary ground-pickup builtin.
  const { FILTH_WORDS } = await import('./index.js');
  check('the scoop only answers to filth words', FILTH_WORDS.test('shit') && FILTH_WORDS.test('the filth'));
  check('...and never to an ordinary take', !FILTH_WORDS.test('all') && !FILTH_WORDS.test('rusty pipe'));
  r = await run('take shit');
  check('with no toilet in the room the scoop falls through to the builtin',
    /can't find|nothing here to take/i.test(r?.message || ''), r?.message);

  // ── Throwing it ─────────────────────────────────────────────────────────────
  // The charge is deliberately its own key. If this ever collapses into
  // attack_npc, a thrown turd becomes a 4-star police response, which is absurd.
  const { CRIME_DEFAULTS } = await import('../../server/engine/crimes.js');
  check('throwing filth has its own charge', !!CRIME_DEFAULTS.filth_assault);
  check('...that is nowhere near an assault response',
    CRIME_DEFAULTS.filth_assault.stars < CRIME_DEFAULTS.attack_npc.stars, CRIME_DEFAULTS.filth_assault.stars);
  check('...but worse than tagging a wall',
    CRIME_DEFAULTS.filth_assault.stars > CRIME_DEFAULTS.graffiti.stars);

  // `throw` must still mean `stow`. The matcher claims only `throw X at Y` where
  // X is filth; a bare throw, or a throw of anything else, falls through to the
  // alias every existing player already has their fingers trained on.
  // `throw` reads its preposition rather than being blanket-aliased to `stow`.
  // The alias rewrote the first word before dispatch, so it claimed `throw X at
  // Y` too and silently stowed things the player meant to lob at somebody.
  const { getAlias } = await import('../../server/engine/commands/aliases.js');
  check('throw is no longer blanket-aliased to stow', getAlias('throw') !== 'stow', getAlias('throw'));
  r = await run('throw rustypipe at nobodyhere');
  check('throwing a non-filth item is not claimed by bodily',
    !/don't see .* here to throw/i.test(r?.message || ''), r?.message);
  check('...and says so rather than silently stowing it',
    /can't throw that/i.test(r?.message || ''), r?.message);
  r = await run('throw rustypipe in nosuchbin');
  check('throw <thing> in <container> still reaches stow',
    /don't see a container|don't have|container not found/i.test(r?.message || ''), r?.message);

  // Hands wash clean without being a free shower: clearBodyStain is part-scoped,
  // which is the only thing stopping `wash hands` from stripping a stain that is
  // on somebody's face.
  p.appearance_data = { soiled_state: { type: 'feces', locations: ['hands'] } };
  check('washing hands clears filth on the hands', await clearBodyStain(p, 'hands') === true);
  check('...and really clears it', !p.appearance_data.soiled_state);
  p.appearance_data = { soiled_state: { type: 'feces', locations: ['face'] } };
  check('washing hands does not clear a stain somewhere else',
    await clearBodyStain(p, 'hands') === false && !!p.appearance_data.soiled_state);
  p.appearance_data = {};

  // ── fart: deliberate, scaled, and on a leash ────────────────────────────────
  // The gamble: past ~75% full, farting risks the other thing entirely.
  const { fartRisk } = await import('./index.js');
  check('a comfortable gut carries no risk at all', fartRisk(0.5) === 0 && fartRisk(0.74) === 0);
  check('risk starts only past the floor', fartRisk(0.8) > 0);
  check('...and climbs toward the involuntary ceiling', fartRisk(1) > fartRisk(0.85));
  check('it is a gamble, never a certainty', fartRisk(1) < 0.5, fartRisk(1));
  check('the risk band overlaps the warnings the player already gets',
    fartRisk(80 / 110) === 0 && fartRisk(95 / 110) > 0);

  const savedLoad = p.digestive_load;
  // Deliberately below the risk floor: this is testing the verb and the cooldown,
  // and a 45% chance of soiling the fake player mid-suite would be flaky.
  p.digestive_load = 60;
  r = await run('fart');
  // Deliberately not matched against the prose — there are eight styles and the
  // line is rolled, so asserting any particular wording just breaks whenever a
  // style is added. It ran and it didn't error; that's the contract.
  check('fart is a live verb', r?.type === 'output' && !!r.message, r?.message);
  r = await run('fart');
  check('...and is on a cooldown', /nothing left in the tank/i.test(r?.message || ''), r?.message);

  // Pressure drives the sound, and an empty gut has nothing to give.
  await import('../../client/shared/procedural-sfx.js');
  const P = globalThis.ProceduralSFX;
  const small = P.buildActionCue({ action: 'flatus', intensity: 0.1, seed: 7 });
  const huge  = P.buildActionCue({ action: 'flatus', intensity: 1.0, seed: 7 });
  check('a full gut farts longer than an empty one',
    huge.config.duration > small.config.duration, { small: small.config.duration, huge: huge.config.duration });
  check('...and lower', huge.config.layers[0].freq < small.config.layers[0].freq);

  // STYLE is the second axis. Scaling one shape by pressure made every fart the
  // same fart; the point is not knowing which one you'll get.
  const rolled = new Set();
  for (let k = 0; k < 24; k++) rolled.add(P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: k }).style);
  check('the same pressure produces several different styles', rolled.size >= 4, [...rolled]);
  check('a nearly-empty gut can only manage the weak ones', (() => {
    const weak = new Set();
    for (let k = 0; k < 16; k++) weak.add(P.buildActionCue({ action: 'flatus', intensity: 0.08, seed: k }).style);
    return !weak.has('drone') && !weak.has('ripper');
  })());
  check('the style is seeded, so the client rebuilds the one the server rolled',
    P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: 77 }).style
      === P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: 77 }).style);
  check('a named style is honoured rather than re-rolled',
    P.buildActionCue({ action: 'flatus', intensity: 0.8, state: 'drone', seed: 3 }).style === 'drone');
  check('a multi-pulse style really is several reports',
    P.buildActionCue({ action: 'flatus', intensity: 0.9, state: 'staccato', seed: 3 }).config.layers.length
      > P.buildActionCue({ action: 'flatus', intensity: 0.9, state: 'drone', seed: 3 }).config.layers.length);

  // Prose and sound must agree — the room shouldn't read "a small squeak" over a
  // two-second drone. Bodily owns the eligibility, so it has to match the table.
  const { _test: bodilyTest } = await import('./index.js').then(m => ({ _test: m })).catch(() => ({ _test: null }));
  // Prose and sound must agree — the room must never read "a small squeak" over
  // a two-second drone. The two tables share only the style NAME (bodily owns
  // when it happens and what it reads as; audio owns what it sounds like), so
  // the one thing that can drift is the key set. Guard exactly that.
  const { FART_STYLE_LINES } = await import('./index.js');
  const audioStyles = Object.keys(P.FLATUS_STYLES).sort();
  const proseStyles = Object.keys(FART_STYLE_LINES).sort();
  check('every style the generator can roll has a line for the room',
    audioStyles.join() === proseStyles.join(), { audio: audioStyles, prose: proseStyles });
  check('every style is reachable at some pressure',
    proseStyles.every(k => (FART_STYLE_LINES[k].min ?? 0) <= (FART_STYLE_LINES[k].max ?? 1)));

  // The stream scales the same way, and the dribble runs on after a big one.
  const trickle = P.buildActionCue({ action: 'stream', intensity: 0.1, seed: 7 });
  const torrent = P.buildActionCue({ action: 'stream', intensity: 1.0, seed: 7 });
  check('a barely-full bladder does not splatter', trickle.config.layers.length < torrent.config.layers.length,
    { trickle: trickle.config.layers.length, torrent: torrent.config.layers.length });
  check('a full one is louder', torrent.config.layers[0].gain > trickle.config.layers[0].gain);
  const dribLow  = P.buildActionCue({ action: 'stream', intensity: 0.1, state: 'dribble', seed: 7 });
  const dribHigh = P.buildActionCue({ action: 'stream', intensity: 1.0, state: 'dribble', seed: 7 });
  check('the more you had, the longer it dribbles out',
    dribHigh.config.duration > dribLow.config.duration, { low: dribLow.config.duration, high: dribHigh.config.duration });
  p.digestive_load = savedLoad;

  // ── Condition: the survival meters finally cost something ───────────────────
  // Before this, you could be starving and freezing and still swing, dodge and
  // shoot exactly as well as a warm, fed man. These are the sideways edges.
  const { effectiveStat, statPenalty, conditionReport } = await import('../../server/engine/condition.js');
  const { skillStatBonus } = await import('../../server/engine/skills.js');
  const WARM = { stat_reflexes: 6, stat_brawn: 6, stat_cool: 6, stat_brains: 6, stat_senses: 6,
    stat_endurance: 6, hunger: 100, thirst: 100, body_temp_c: 37 };

  check('a warm, fed player acts on their full sheet',
    effectiveStat(WARM, 'stat_reflexes') === 6 && statPenalty(WARM, 'stat_reflexes') === 0);
  check('cold hands cost Reflexes', effectiveStat({ ...WARM, body_temp_c: 32 }, 'stat_reflexes') < 6);
  check('...and colder costs more',
    effectiveStat({ ...WARM, body_temp_c: 28 }, 'stat_reflexes')
      < effectiveStat({ ...WARM, body_temp_c: 32 }, 'stat_reflexes'));
  check('hunger costs Brawn', effectiveStat({ ...WARM, hunger: 4 }, 'stat_brawn') < 6);
  check('thirst costs Endurance, not Cool',
    effectiveStat({ ...WARM, thirst: 4 }, 'stat_endurance') < 6
      && effectiveStat({ ...WARM, thirst: 4 }, 'stat_cool') === 6);
  check('...and worse thirst costs more',
    effectiveStat({ ...WARM, thirst: 4 }, 'stat_endurance')
      < effectiveStat({ ...WARM, thirst: 15 }, 'stat_endurance'));
  check('...with the cognitive hit held back until it is severe',
    effectiveStat({ ...WARM, thirst: 15 }, 'stat_brains') === 6
      && effectiveStat({ ...WARM, thirst: 4 }, 'stat_brains') < 6);
  check('heat costs Brains, not Reflexes', (() => {
    const hot = { ...WARM, body_temp_c: 43 };
    return effectiveStat(hot, 'stat_brains') < 6 && effectiveStat(hot, 'stat_reflexes') === 6;
  })());
  check('being wrecked never makes you helpless — stats floor at 1',
    effectiveStat({ ...WARM, stat_reflexes: 1, body_temp_c: 28 }, 'stat_reflexes') === 1);
  check('condition never makes you BETTER than your sheet',
    effectiveStat({ ...WARM, body_temp_c: 37, hunger: 100 }, 'stat_reflexes') === 6);

  // The whole point of putting the edge in skillStatBonus: it reaches every
  // skill in the game without a single call site changing.
  check('cold reaches dodge through the one stat funnel',
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'dodge') < skillStatBonus(WARM, 'dodge'));
  check('...and to-hit with a blade', 
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'blades') < skillStatBonus(WARM, 'blades'));
  check('...and a skill governed by neither is untouched by cold',
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'cooking') === skillStatBonus(WARM, 'cooking'));
  check('the player is told why they are worse',
    conditionReport({ ...WARM, body_temp_c: 32, hunger: 10 }).length === 2);
  check('a healthy player has nothing to report', conditionReport(WARM).length === 0);

  // ── Fatigue: derived, gentle, and only sleep undoes it ──────────────────────
  const { fatigueOf, FATIGUE_FULL_HOURS, FATIGUE_TIRED, FATIGUE_RUINED, SLEEP_FULL_CLEAR_MINUTES,
          sleepRecoveryPerMinute, fatigueSpanMs, STIM_FATIGUE_RELIEF, STIM_FATIGUE_INTEREST } =
    await import('../../server/engine/condition.js');
  const { getTimeScale } = await import('../../server/engine/gametime.js');
  // GAME hours, not real ones — the span shrinks as the game-speed knob rises, so
  // the assertions below have to be written in the units the design is stated in.
  const awake = h => ({ ...WARM, last_slept_at: Date.now() - (h / FATIGUE_FULL_HOURS) * fatigueSpanMs() });

  check('a player who has never slept is treated as fresh, not wrecked',
    fatigueOf({ ...WARM, last_slept_at: null }) === 0);
  check('fatigue builds with time awake', fatigueOf(awake(4)) > fatigueOf(awake(1)));
  check('...and is gentler than hunger — a long session before it bites',
    fatigueOf(awake(48)) < FATIGUE_TIRED, fatigueOf(awake(48)));
  // The curve is written off what a person actually does, so these two are the
  // load-bearing ones: a hard night has to stay affordable, and it's the later
  // nights that are supposed to hurt. The hour marks are the original design
  // (12h / 24h / 72h) stretched 4×, alongside the rest of the biological demands.
  check('two days up costs you nothing mechanical',
    statPenalty(awake(48), 'stat_brains') === 0 && statPenalty(awake(48), 'stat_reflexes') === 0);
  check('...and four days up is unpleasant, not crippling',
    statPenalty(awake(96), 'stat_brains') <= 1 && statPenalty(awake(96), 'stat_reflexes') === 0);
  check('...but twelve days up is ruinous', fatigueOf(awake(288)) >= FATIGUE_RUINED);
  check('it caps rather than running away', fatigueOf(awake(1000)) === 100);
  check('exhaustion costs Brains first', statPenalty(awake(FATIGUE_FULL_HOURS), 'stat_brains') > 0);
  check('...and Reflexes only once it is severe',
    statPenalty(awake(24), 'stat_reflexes') === 0 && statPenalty(awake(FATIGUE_FULL_HOURS), 'stat_reflexes') > 0);
  check('tired reaches combat through the same funnel',
    skillStatBonus(awake(FATIGUE_FULL_HOURS), 'dodge') < skillStatBonus(WARM, 'dodge'));
  check('being tired is reported, not silent',
    conditionReport(awake(FATIGUE_FULL_HOURS)).some(c => /tired|exhausted|no sleep/.test(c.why)));

  // Sleep undoes it in REAL time — fast enough to be a mechanic, slow enough to
  // be a decision.
  check('sleep is meaningfully faster than being awake', sleepRecoveryPerMinute() > 60000);
  // Short enough that nobody spends their evening in a bed. The mechanic is
  // worthless if the optimal play is lying down. This must hold at ANY game
  // speed — the constant it replaced was a fixed multiple of real time and
  // silently became 1.6 minutes at 3×.
  check('...and a full night clears in about five minutes, not half an hour', (() => {
    const minutes = fatigueSpanMs() / sleepRecoveryPerMinute();
    return minutes >= 3 && minutes <= 7;
  })(), fatigueSpanMs() / sleepRecoveryPerMinute());
  check('a full night awake is FATIGUE_FULL_HOURS of GAME time', (() => {
    const gameHours = (fatigueSpanMs() * getTimeScale()) / 3600000;
    return Math.abs(gameHours - FATIGUE_FULL_HOURS) < 0.01;
  })());

  // ── Uppers: relief now, with interest ──────────────────────────────────────
  check('a stimulant erases fatigue faster than it accrues', STIM_FATIGUE_RELIEF > 1);
  check('...and the crash costs more than the relief was worth', STIM_FATIGUE_INTEREST > 1);
  check('being wired reads as less tired everywhere at once', (() => {
    const p = awake(FATIGUE_FULL_HOURS);
    const before = fatigueOf(p);
    p.last_slept_at += 60000 * STIM_FATIGUE_RELIEF;   // one minute wired
    return fatigueOf(p) < before && statPenalty(p, 'stat_brains') <= statPenalty(awake(FATIGUE_FULL_HOURS), 'stat_brains');
  })());
  check('...and paying the debt back leaves you worse than never dosing', (() => {
    const start = Date.now() - fatigueSpanMs() * 0.5;
    const relief = 60000 * STIM_FATIGUE_RELIEF;
    const after = start + relief - relief * STIM_FATIGUE_INTEREST;
    return after < start;
  })());
  check('sleep deprivation bleeds sanity only from the second night on, never before',
    fatigueOf(awake(96)) < FATIGUE_RUINED && fatigueOf(awake(288)) >= FATIGUE_RUINED);

  // The reward has to outweigh the penalty — sleeping is optional, so it must be
  // worth doing rather than merely something bad you're avoiding.
  const { effectStatBonus } = await import('../../server/engine/effects.js');
  const restedPlayer = { ...WARM, statuses: [{ name: 'rested', duration: 100 }] };
  check('Well Rested actually raises stats', effectStatBonus(restedPlayer, 'stat_brains') > 0);
  check('...and the reward beats the penalty for skipping sleep',
    effectStatBonus(restedPlayer, 'stat_brains') >= statPenalty(awake(96), 'stat_brains'));
  check('a rested player is better than a merely-not-tired one',
    effectiveStat(restedPlayer, 'stat_brains') > effectiveStat(WARM, 'stat_brains'));
  check('being tired is a nudge, not a crippling', statPenalty(awake(192), 'stat_brains') <= 1);

  // ── Cool ↔ sanity: composure protects, and losing it costs ─────────────────
  const { resistSanityLoss } = await import('../../server/engine/condition.js');
  const cool = (c, san) => ({ ...WARM, stat_cool: c, sanity: san, sanity_max: 100 });
  check('a cool head takes less of a sanity hit',
    resistSanityLoss(cool(8, 100), 10) < resistSanityLoss(cool(2, 100), 10));
  check('...but nobody is immune', resistSanityLoss(cool(20, 100), 10) > 0);
  check('losing your grip costs you your composure',
    effectiveStat(cool(8, 10), 'stat_cool') < effectiveStat(cool(8, 100), 'stat_cool'));
  check('...which makes the next hit land harder — the loop is real',
    resistSanityLoss(cool(8, 10), 10) > resistSanityLoss(cool(8, 100), 10));
  check('but the spiral has a floor and cannot reach zero',
    effectiveStat(cool(1, 0), 'stat_cool') === 1);

  // ── adjustSanity: the funnel every writer goes through ─────────────────────
  // Before this existed `resistSanityLoss` was dead code and Cool bought you
  // nothing at all. These cases pin the two halves that are easy to get wrong.
  const { adjustSanity, registerSanityResistor } = await import('../../server/engine/condition.js');
  const chill = cool(10, 50), rattledGuy = cool(1, 50);
  check('a loss is resisted by composure',
    Math.abs(adjustSanity({ ...chill }, -10)) < Math.abs(adjustSanity({ ...rattledGuy }, -10)));
  check('...and a GAIN is never damped — Cool is not a tax on drinks',
    adjustSanity({ ...chill }, 10) === 10 && adjustSanity({ ...rattledGuy }, 10) === 10);
  check('resistance can never swallow a hit whole',
    adjustSanity({ ...cool(20, 50) }, -1) === -1);
  const atFloor = cool(10, 0), atCap = cool(10, 100);
  adjustSanity(atFloor, -50); adjustSanity(atCap, 50);
  check('clamps at 0 and sanity_max', atFloor.sanity === 0 && atCap.sanity === 100);
  check('a no-op change reports zero and dirties nothing',
    adjustSanity({ ...cool(10, 100) }, 5) === 0);

  let sawLoss = null;
  registerSanityResistor((p, reason) => { sawLoss = reason; return 0.5; }, '_regress');
  const resisted = adjustSanity({ ...cool(1, 50) }, -20, 'test_reason');
  registerSanityResistor(() => 0, '_regress');   // stand down (keyed by owner, so this replaces)
  check('a registered resistor sees the reason and shrinks the loss',
    sawLoss === 'test_reason' && Math.abs(resisted) < 20);

  // ── Dreams: sleep is no longer dead time ────────────────────────────────────
  const { rollDream } = await import('../../server/engine/dreams.js');
  const sound = { ...WARM, sanity: 100, sanity_max: 100 };
  const frayed = { ...WARM, sanity: 10, sanity_max: 100 };
  const gather = async (who, n = 60) => {
    const out = new Set();
    for (let k = 0; k < n; k++) { const d = await rollDream(who, { chance: 1 }); if (d) out.add(d); }
    return out;
  };

  const sane = await gather(sound);
  check('dreams vary rather than repeating one line', sane.size >= 3, sane.size);

  let dreamless = 0;
  for (let k = 0; k < 30; k++) if (!(await rollDream(sound, { chance: 0 }))) dreamless++;
  check('a dreamless night is possible', dreamless === 30, dreamless);

  // Sanity is the biggest input: a broken mind should reach pools a sound one
  // never sees. Asserted on the actual text, not on a placeholder.
  const broken = await gather(frayed);
  check('a frayed mind dreams things a sound one never does',
    [...broken].some(d => !sane.has(d)), { sound: sane.size, frayed: broken.size });

  // The body reaches into sleep — you dream about what you went to bed needing.
  const starving = await gather({ ...sound, hunger: 5 });
  check('a starving player dreams about food',
    [...starving].some(d => /meal|eat|jaw/i.test(d)), [...starving].slice(0, 3));
  const bloody = await gather({ ...sound, covered_in_blood: 1 });
  check('coming to bed covered in blood follows you into it',
    [...bloody].some(d => /washing|hands/i.test(d)));

  // ── Dreamscape: the dream you can walk around in ────────────────────────────
  const { buildDreamscape, dissolveDreamscape, wakeFromDream, isDreamZone, dreamObjectsAt } =
    await import('../../server/engine/dreamscape.js');
  const { world } = await import('../../server/engine/world.js');

  const entry = await buildDreamscape('regress-dreamer', { size: 4, tether: { zone: 'The Reach' }, cause: 'dream' });
  check('a dreamscape builds walkable rooms', isDreamZone(entry) && !!world.zones.get(entry));

  // A THIN POOL SHRINKS THE DREAM, it does not repeat a room. Asking for 5 rooms
  // out of a 3-room pool used to hand back duplicates, which reads as a bug
  // rather than as a dream.
  const roomsOf = (pid) => [...world.zones.keys()].filter(z => z.includes(pid));
  const thin = await buildDreamscape('regress-thin', { size: 5, cause: 'drug', drugId: 'drug_khole' });
  const thinRooms = roomsOf('regress-thin').map(z => world.zones.get(z).name);
  check('asking for more rooms than exist yields a SHORTER dream, not a repetitive one',
    !!thin && thinRooms.length === new Set(thinRooms).size, thinRooms.join(' / '));
  check('...and never more rooms than the pool has', thinRooms.length <= 3, thinRooms.length);
  dissolveDreamscape('regress-thin');
  check('...with somewhere to go', Object.keys(world.zones.get(entry).exits || {}).length > 0);
  check('...and things to poke at', dreamObjectsAt(entry).length > 0);
  check('dream rooms are flagged as dreams', world.zones.get(entry).flags?.dream === true);
  // NOT "you cannot be fought in one" — nothing in the combat path reads no_combat.
  // What actually prevents a fight is that the rooms are private, so no attacker can
  // be in one. The flag is reserved for the day that stops being true; asserting it
  // as enforcement would be a false assurance. See docs/systems-dreams.md.
  check('dream rooms carry the (currently unenforced) no_combat marker',
    world.zones.get(entry).flags?.no_combat === true);

  // The leak that matters: a dreamscape left registered costs zones for the life
  // of the process, every single sleep.
  const zonesBefore = world.zones.size;
  dissolveDreamscape('regress-dreamer');
  check('waking dissolves every room of it', world.zones.size < zonesBefore, { before: zonesBefore, after: world.zones.size });
  check('...leaving none behind', ![...world.zones.keys()].some(z => z.includes('regress-dreamer')));

  // Being yanked out — by waking, by a command, or by someone attacking you in
  // your bed. All five wake paths call this, and it has to be safe on someone
  // who was never dreaming.
  check('waking from no dream at all is a safe no-op', wakeFromDream({ id: 'x' }) === false);
  check('...and on a sleeping non-dreamer too',
    wakeFromDream({ id: 'x', sleeping: { inDream: false } }) === false);

  const dreamer = { id: 'regress-yank', current_zone: null, sleeping: { inDream: true, bodyZone: p.current_zone } };
  dreamer.current_zone = await buildDreamscape('regress-yank', { size: 2 });
  check('being attacked mid-dream puts you back in your body',
    wakeFromDream(dreamer) === true && dreamer.current_zone === p.current_zone);
  check('...and takes the dream with it',
    ![...world.zones.keys()].some(z => z.includes('regress-yank')));

  // THE BODY STAYS IN THE ROOM. Walking off into a dream must not delete the
  // sleeper from the room's occupant set — that is what `look` reads and what a
  // burglar or a killer resolves a target from, so an evicted body is untouchable
  // in its own bed. And nothing may leak the other way: the room they're lying in
  // must stay inaudible to them.
  const { receivesZoneMessage } = await import('../../server/engine/delivery.js');
  const bodyRoom = world.zones.get(p.current_zone);
  const sleeper = { id: 'regress-body', current_zone: p.current_zone, sleeping: { inDream: false, bodyZone: p.current_zone } };
  bodyRoom.players.add(sleeper.id);
  sleeper.current_zone = await buildDreamscape('regress-body', { size: 2 });
  sleeper.sleeping.inDream = true;
  check('the sleeping body stays in the room it lay down in',
    bodyRoom.players.has(sleeper.id));
  check('...but the dreamer hears nothing of that room',
    receivesZoneMessage(sleeper, p.current_zone) === false);
  // ...while DOES hear the dream they're inside. The "asleep players perceive
  // nothing" rule is about the real room; the dreamscape is the only room they're
  // actually in, and the scheduled ambientTick already walks transient zones, so
  // without this exception every dream room's authored ambience is built, selected
  // and then silently dropped at delivery.
  check('...and does hear the dream itself',
    receivesZoneMessage(sleeper, sleeper.current_zone) === true);
  wakeFromDream(sleeper);
  check('...and waking leaves them there exactly once',
    sleeper.current_zone === p.current_zone && bodyRoom.players.has(sleeper.id));
  bodyRoom.players.delete(sleeper.id);

  // KILLED INSTANTLY MID-DREAM. handlePlayerDeath captures `deathZone` from
  // current_zone, so it has to wake you BEFORE it reads it — otherwise the corpse
  // spawns in a dream room that dissolves a line later, taking the body's whole
  // inventory with it and leaving the killer nothing to loot.
  const killed = { id: 'regress-deathdream', current_zone: p.current_zone, sleeping: { inDream: false, bodyZone: p.current_zone } };
  killed.current_zone = await buildDreamscape('regress-deathdream', { size: 2 });
  killed.sleeping.inDream = true;
  wakeFromDream(killed);   // the call handlePlayerDeath makes before reading current_zone
  check('a player killed mid-dream dies in their bed, not in the dream',
    killed.current_zone === p.current_zone && !isDreamZone(killed.current_zone));
  check('...and the dream is gone with them',
    ![...world.zones.keys()].some(z => z.includes('regress-deathdream')));

  // The order is the whole fix, so assert it at the source rather than trusting
  // the comment: the wake must appear before deathZone is captured.
  // ── Transient zones must never reach the durable row ────────────────────────
  // A dream/void room is RAM-only. Persisting one used to strand the player in a
  // zone with no `zones` row on the disconnect checkpoint.
  const { persistableZone, isTransientZone: isTZ } = await import('../../server/engine/world.js');
  const stranded = { id: 'regress-persist', anchor_zone: p.current_zone, sleeping: { inDream: true, bodyZone: p.current_zone } };
  stranded.current_zone = await buildDreamscape('regress-persist', { size: 1 });
  check('a dream room really is a transient zone', isTZ(stranded.current_zone));
  check('...and never gets written to players.current_zone',
    persistableZone(stranded) === p.current_zone, persistableZone(stranded));
  check('an ordinary zone persists as itself',
    persistableZone({ current_zone: p.current_zone }) === p.current_zone);
  check('...and a transient zone with no body falls back to the anchor',
    persistableZone({ current_zone: stranded.current_zone, anchor_zone: 'zone_start' }) === 'zone_start');
  dissolveDreamscape('regress-persist');

  // ── What your own commands do from inside a dream ───────────────────────────
  const { DREAM_VERBS: DV } = await import('../../server/engine/commands/index.js');
  check('a dreamer can walk and look', DV.has('north') && DV.has('look') && DV.has('examine'));
  check('...and talk and say', DV.has('talk') && DV.has('say'));
  check('...and wake deliberately', DV.has('wake'));
  // The allowlist is the safety property: anything that writes the world from a
  // room about to be deleted orphans what it wrote. `drop` is the archetype.
  check('but NOT drop — a dream room is deleted and would orphan the item', !DV.has('drop'));
  check('...nor stow/take', !DV.has('stow') && !DV.has('take'));
  check('...nor the tablet', !DV.has('tablet'));

  // ── Templates are content, and the pools do not bleed ───────────────────────
  const { query: q } = await import('../../server/models/db.js');
  const pool = async (sql, a = []) => (await q(sql, a)).rows.length;

  check('sleep draws from an authored dream pool',
    await pool(`SELECT 1 FROM dream_templates WHERE cause='dream'`) >= 5);
  check('a dream template never carries a drug',
    await pool(`SELECT 1 FROM dream_templates WHERE cause='dream' AND drug_id IS NOT NULL`) === 0);
  check('there is a default drug set to fall back to',
    await pool(`SELECT 1 FROM dream_templates WHERE cause='drug' AND drug_id IS NULL`) > 0);

  // The mode split: dissociatives take you somewhere, psychedelics stay put and
  // warp the room. A drug appearing in BOTH pools would mean the split leaked.
  for (const d of ['drug_khole', 'drug_deadair', 'drug_threshold']) {
    check(`${d} is a dissociative — it has rooms`,
      await pool(`SELECT 1 FROM dream_templates WHERE cause='drug' AND drug_id=$1`, [d]) > 0);
    check(`...and no live-world transforms`,
      await pool(`SELECT 1 FROM drug_transforms WHERE drug_id=$1`, [d]) === 0);
  }
  // The five added dissociatives. Each must have its OWN rooms — falling through
  // to the default set would make salvia, DMT and a whippet feel identical, which
  // is the one thing the per-drug pool exists to prevent.
  for (const d of ['drug_salvia', 'drug_dmt', 'drug_dxm', 'drug_nitrous', 'drug_ibogaine']) {
    check(`${d} has its own rooms, not the default set`,
      await pool(`SELECT 1 FROM dream_templates WHERE cause='drug' AND drug_id=$1`, [d]) >= 3);
    check(`...and is wired as a dissociative`,
      (await q(`SELECT effects->'hallucination'->>'mode' AS m FROM drugs WHERE id=$1`, [d])).rows[0]?.m === 'dreamzone');
    check(`...with an item to actually get it`,
      await pool(`SELECT 1 FROM items WHERE id=$1`, [d.replace('drug_', 'item_')]) === 1);
    check(`...and a way to make it`,
      await pool(`SELECT 1 FROM recipes WHERE id=$1`, [d.replace('drug_', 'cook_')]) === 1);
  }
  // Real-world proportions preserved: a whippet is seconds, ibogaine is a night.
  const dur = async (id) => (await q(`SELECT duration_seconds FROM drugs WHERE id=$1`, [id])).rows[0]?.duration_seconds;
  check('a whippet is the shortest thing in the game', await dur('drug_nitrous') < await dur('drug_salvia'));
  check('...salvia is shorter than DMT', await dur('drug_salvia') < await dur('drug_dmt'));
  check('...DMT is far shorter than robo', await dur('drug_dmt') < await dur('drug_dxm'));
  check('...and ibogaine is the longest by a distance', await dur('drug_ibogaine') > await dur('drug_dxm'));
  // Salvia and DMT genuinely produce no tolerance — that is a real pharmacological
  // fact worth not quietly normalising away when someone tunes the numbers.
  const tol = async (id) => (await q(`SELECT effects->'tolerance'->>'gain_per_dose' AS g FROM drugs WHERE id=$1`, [id])).rows[0]?.g;
  check('DMT builds no tolerance, as in life', Number(await tol('drug_dmt')) === 0);
  check('...nor does salvia', Number(await tol('drug_salvia')) === 0);

  for (const d of ['drug_blotter', 'drug_mescaline', 'drug_psilocybin']) {
    check(`${d} is a psychedelic — it transforms the room`,
      await pool(`SELECT 1 FROM drug_transforms WHERE drug_id=$1`, [d]) > 0);
  }
  check('there is a default transform set too',
    await pool(`SELECT 1 FROM drug_transforms WHERE drug_id IS NULL`) > 0);

  // ── Transforms are per-viewer and MUST NOT mutate the shared cache ──────────
  const { addTransform, applyTransforms, getTransform, clearTransforms } =
    await import('../../server/engine/phantoms.js');
  const shared = [{ id: 'furn_regress_chair', name: 'a plain chair', description: 'A chair.' }];
  addTransform('regress-tripper', 'furn_regress_chair', { name: 'a breathing chair', description: 'It is breathing.', looks: ['In. Out.'], says: ['Sit.'] });
  const seen = applyTransforms('regress-tripper', shared);
  check('the tripper sees the transformed name', seen[0].name === 'a breathing chair', seen[0].name);
  check('...and NOBODY else does', applyTransforms('regress-sober', shared)[0].name === 'a plain chair');
  // The row out of getZoneFurniture is shared by everyone in the room. Mutating it
  // would show one player's hallucination to the whole room and poison the cache.
  check('...because the shared row was never touched', shared[0].name === 'a plain chair', shared[0].name);
  check('a sober player has no transform at all', getTransform('regress-sober', 'furn_regress_chair') === null);
  clearTransforms('regress-tripper');
  check('coming down puts the room back', applyTransforms('regress-tripper', shared)[0].name === 'a plain chair');

  // ── An absent body must always read as one ──────────────────────────────────
  // The body-stays-put model puts a lootable, killable person in the room with no
  // outward difference from an alert one unless the room is told. A tripper has no
  // `sleeping` object at all, so keying the tell on `sleeping` (as it first was)
  // left drug users looking wide awake.
  const { bodyTell } = await import('../../server/engine/dreamscape.js');
  const room = p.current_zone;
  check('an alert player has no tell', bodyTell({ current_zone: room }, room) === null);
  check('a sleeper reads as sleeping',
    bodyTell({ current_zone: room, sleeping: { inDream: false } }, room) === 'sleeping');
  const tripEntry = await buildDreamscape('regress-tell', { size: 1, cause: 'drug', drugId: 'drug_khole' });
  check('a drug dreamscape really did build from the khole pool', !!tripEntry);
  check('...and its occupant reads as gone, with no sleeping object at all',
    bodyTell({ current_zone: tripEntry }, room) === 'glassy-eyed');
  check('...while being IN the dream room is not a tell to itself',
    bodyTell({ current_zone: tripEntry }, tripEntry) === null);
  dissolveDreamscape('regress-tell');
  check('a null player is a safe no-op', bodyTell(null, room) === null);

  // ── The reaction pool, and why it has two registers ─────────────────────────
  // A pool of nothing but cosmic pronouncements becomes wallpaper inside one
  // trip: the player learns the register and stops reading. The mundane lines are
  // what keep the strange ones landing, so their presence is a property worth
  // defending rather than an accident of authoring.
  const cnt = async (sql, a = []) => (await q(sql, a)).rows.length;
  check('objects have things to say', await cnt(`SELECT 1 FROM drug_reactions WHERE source='object'`) >= 10);
  check('...and a healthy share of them are COMPLETELY mundane',
    await cnt(`SELECT 1 FROM drug_reactions WHERE source='object' AND tone='normal'`) >= 5);
  check('people in the room react too', await cnt(`SELECT 1 FROM drug_reactions WHERE source='npc'`) >= 6);
  check('...in both registers',
    await cnt(`SELECT 1 FROM drug_reactions WHERE source='npc' AND tone='normal'`) >= 3 &&
    await cnt(`SELECT 1 FROM drug_reactions WHERE source='npc' AND tone='surreal'`) >= 3);
  // An npc line has to address the room as well as the tripper; an object line
  // does not, because nobody else hears the furniture.
  check('every npc reaction tells the room something too',
    await cnt(`SELECT 1 FROM drug_reactions WHERE source='npc' AND (room_line IS NULL OR room_line='')`) === 0);
  check('npc lines carry the tokens that get substituted',
    await cnt(`SELECT 1 FROM drug_reactions WHERE source='npc' AND self_line NOT LIKE '%{npc}%'`) === 0);

  // ── Weather in an unreal place ──────────────────────────────────────────────
  // A dream room is flagged interior, so the ordinary weather line never prints
  // — and weather is most of what sells somewhere as a place. Authored per room
  // and carried onto the transient zone as `dreamWeather`.
  check('dream rooms carry their own impossible weather',
    await pool(`SELECT 1 FROM dream_templates WHERE weather IS NOT NULL AND weather <> ''`) >= 25);
  const wEntry = await buildDreamscape('regress-weather', { size: 1, cause: 'drug', drugId: 'drug_deadair' });
  check('...and it reaches the built room', !!world.zones.get(wEntry)?.dreamWeather,
    world.zones.get(wEntry)?.dreamWeather);
  dissolveDreamscape('regress-weather');
  check('psychedelics warp the real weather instead',
    await pool(`SELECT 1 FROM drug_transforms WHERE scope='weather'`) >= 3);

  // The PARTICLE FIELD is the visual half — the weather FX canvas driven directly,
  // ignoring both the real weather and the indoor gate. Ash falling in a windowless
  // corridor is the point: it SHOWS the rules are off instead of saying so.
  check('dream rooms drive the FX canvas', await pool(`SELECT 1 FROM dream_templates WHERE fx IS NOT NULL`) >= 25);
  const VALID_FX = ['rain', 'snow', 'ash', 'fog', 'wind', 'none'];
  const badFx = (await q(`SELECT id, fx FROM dream_templates WHERE fx IS NOT NULL`)).rows
    .filter(r => !VALID_FX.includes(r.fx));
  // weather-fx.js silently renders nothing for an unknown effect name, so a typo
  // here is invisible rather than loud.
  check('...with effect names the client actually renders', badFx.length === 0,
    badFx.map(r => `${r.id}=${r.fx}`).join(', '));
  const badInt = (await q(`SELECT id, fx_intensity FROM dream_templates WHERE fx IS NOT NULL AND (fx_intensity < 0 OR fx_intensity > 1)`)).rows;
  check('...and intensities inside 0..1', badInt.length === 0, badInt.map(r => r.id).join(', '));
  const fxEntry = await buildDreamscape('regress-fx', { size: 1, cause: 'drug', drugId: 'drug_dmt' });
  check('...carried onto the built room', !!world.zones.get(fxEntry)?.dreamFx?.effect);
  dissolveDreamscape('regress-fx');

  // Per-viewer, and it must not bleed: the weather warp is keyed to the zone it
  // was set in, so walking on does not carry a stale line into the next room.
  const { setWeatherWarp, getWeatherWarp, clearTransforms: clearT } =
    await import('../../server/engine/phantoms.js');
  setWeatherWarp('regress-w', 'zone_a', 'The rain is going up.');
  check('a warp shows in the zone it was set in', getWeatherWarp('regress-w', 'zone_a') === 'The rain is going up.');
  check('...and not in the next room along', getWeatherWarp('regress-w', 'zone_b') === null);
  check('...and never to anyone else', getWeatherWarp('regress-other', 'zone_a') === null);
  clearT('regress-w');
  check('coming down puts the sky back', getWeatherWarp('regress-w', 'zone_a') === null);

  // ── Tethers: the mix of personal and merely strange ─────────────────────────
  const { _rollTether } = await import('../../server/engine/dreamscape.js');
  const tethers = (await q(`SELECT * FROM dream_tethers`)).rows;
  check('there are tether lines to draw on', tethers.length >= 20);
  check('...including impersonal ones', tethers.filter(t => t.kind === 'none').length >= 5,
    'a dream that is always about you is as predictable as one that never is');
  for (const k of ['zone', 'npc', 'item', 'death']) {
    check(`...and ${k} lines that hook onto real state`, tethers.some(t => t.kind === k));
  }
  // A personal line MAY omit the token — "you have done this before and it went
  // badly" is gated on having actually died without naming who did it, and reads
  // better for the restraint. What matters is that each KIND can still name its
  // fact, or the fact is decorative and the pool is secretly all flavour.
  for (const k of ['zone', 'npc', 'item', 'death']) {
    check(`${k} lines can name the thing they are about`,
      tethers.some(t => t.kind === k && /\{value\}/.test(t.line)));
  }
  check('no impersonal line carries a token it cannot fill',
    tethers.filter(t => t.kind === 'none' && /\{value\}/.test(t.line)).length === 0);

  // The failure that would reach a player: a line whose fact is missing printing
  // a literal "{value}". Roll a lot with an EMPTY fact set and assert never.
  let leaked = 0, personal = 0, blank = 0;
  for (let i = 0; i < 400; i++) {
    const out = _rollTether(tethers, {});
    if (/\{value\}/.test(out)) leaked++;
    if (!out) blank++;
  }
  check('an empty life never leaks a raw {value} token', leaked === 0);
  check('...and still sometimes says nothing at all', blank > 0);

  // With facts available, both registers must actually appear across a run.
  const facts = { zone: 'The Reach', npc: 'Cyd', item: 'a screwdriver', death: 'Killed by a dog' };
  const seenPersonal = new Set();
  for (let i = 0; i < 400; i++) {
    const out = _rollTether(tethers, facts);
    if (/\{value\}/.test(out)) leaked++;
    for (const [k, v] of Object.entries(facts)) if (out.includes(v)) seenPersonal.add(k);
    if (out && !Object.values(facts).some(v => out.includes(v))) personal++;   // impersonal line
  }
  check('...and never leaks one when facts ARE present', leaked === 0);
  check('a tethered dream draws on several parts of a life', seenPersonal.size >= 3, [...seenPersonal].join(', '));
  check('...while still leaving room for the merely strange', personal > 0);

  // VARIETY. A pool that repeats inside one dream feels tiny however many rows it
  // holds — a repeat two rooms apart is far more noticeable than the same line
  // turning up next week. rollTether takes a per-instance `used` set for exactly
  // this; assert it actually prevents a repeat across a realistic dream length.
  for (const k of ['none', 'zone', 'npc', 'item', 'death']) {
    check(`the ${k} pool is deep enough not to go stale`,
      tethers.filter(t => t.kind === k).length >= 10,
      `${tethers.filter(t => t.kind === k).length} lines`);
  }
  let repeats = 0;
  for (let trial = 0; trial < 200; trial++) {
    const used = new Set(); const seen = [];
    for (let room = 0; room < 4; room++) {
      const out = _rollTether(tethers, facts, used);
      if (out) seen.push(out);
    }
    if (seen.length !== new Set(seen).size) repeats++;
  }
  check('...and no line repeats inside a single dream', repeats === 0, `${repeats}/200 dreams repeated`);

  // The death fact is the AGENT ("a dog"), never the raw cause_label sentence —
  // pasting "Killed by a dog." in mid-line read as a database string stapled on.
  const deathLines = tethers.filter(t => t.kind === 'death' && /\{value\}/.test(t.line));
  check('death lines weave the killer into a sentence, not quote a log entry',
    deathLines.every(t => !/^\s*\{value\}\.?\s*$/.test(t.line)),
    deathLines.filter(t => /^\s*\{value\}\.?\s*$/.test(t.line)).map(t => t.id).join(', '));

  // NOT AUTOMATED, deliberately. The killer may be a PERSON ("Cyd") or a CREATURE
  // ("a dog"), so no line may take a pronoun FOR THE KILLER — "you recognise Cyd
  // before you can see it" is wrong, and "they" is wrong the other way. But a
  // regex for "pronoun after the token" flags "where {value} opened it" (the it is
  // your body) and "this place does not think it was a big thing" (the killing),
  // both of which are correct. A check that fails on good writing gets deleted or
  // written around, which is worse than no check — so this stays an authoring rule
  // in the comment rather than a red build. Watch for it in review.
  //
  // What IS mechanically checkable: the token must never be the whole line, which
  // is what a raw cause_label paste looks like.

  // A nightmare is subtle about everything EXCEPT its subject. Most of the pool
  // should name the thing outright rather than gesturing at it — the earlier
  // draft was so oblique the lines could have been about anybody.
  check('most death lines name the thing that killed you outright',
    deathLines.length >= tethers.filter(t => t.kind === 'death').length * 0.6,
    `${deathLines.length} of ${tethers.filter(t => t.kind === 'death').length} name it`);

  const { readFile } = await import('fs/promises');
  const loopSrc = await readFile(new URL('../../server/engine/gameLoop.js', import.meta.url), 'utf8');
  check('handlePlayerDeath wakes from the dream before it captures deathZone',
    loopSrc.indexOf('wakeFromDream(player)') < loopSrc.indexOf('const deathZone = player.current_zone'));

  // ── Smell: the room-level sense ─────────────────────────────────────────────
  const { stainZone, taintAir, zoneAir, TAINT_MS } = await import('../../server/engine/bodily.js');

  r = await run('smell');
  check('smell is a live verb and reports something', /breathe in/i.test(r?.message || ''), r?.message);
  check('a clean room says so rather than listing nothing',
    /nothing worth reporting/i.test(r?.message || '') || /\n/.test(r?.message || ''), r?.message);

  // A stain on the floor is persistent and smell finds it.
  stainZone(p.current_zone, 'feces');
  r = await run('smell');
  check('smell finds what someone left on the floor', /shit/i.test(r?.message || ''), r?.message);

  // Air taint is the OTHER shape: no stain, and it genuinely expires. That
  // distinction is the whole joke — walking away has to actually work.
  taintAir(p.current_zone, 'fart');
  r = await run('smell');
  check('a fart hangs in the air and is findable', /fart|flatulence/i.test(r?.message || ''), r?.message);
  // Stacking, asserted relative to whatever is already hanging — anything else
  // in the suite that farts (the `fart` verb has its own tests above) would
  // otherwise break this by arriving first.
  check('...and stacks rather than resetting when it happens again', (() => {
    const before = zoneAir(p.current_zone).find(a => a.type === 'fart')?.n || 0;
    taintAir(p.current_zone, 'fart');
    const after = zoneAir(p.current_zone).find(a => a.type === 'fart')?.n || 0;
    return after > before || after === 3;   // 3 is the cap
  })());
  check('...and is gone once it has had its minute',
    zoneAir(p.current_zone, Date.now() + TAINT_MS + 1).length === 0);
  check('an expired taint is dropped from the store as it is read',
    !(zoneAir(p.current_zone, Date.now() + TAINT_MS + 1)).some(a => a.type === 'fart'));

  // The gather hook is what lets a room stink of several things at once —
  // a fireHook would have kept only the last contributor.
  const { gatherHook } = await import('../../server/engine/plugins.js');
  const all = await gatherHook('zone.smells', { id: p.current_zone }, p);
  check('zone.smells gathers from every plugin rather than last-wins', Array.isArray(all), typeof all);

  // ── Acuity: the band, not the contributors ──────────────────────────────────
  const { perceptionBand, perceive, acuityFor, BASE_FLOOR, BASE_LIMIT } = await import('../../server/engine/senses.js');

  const base = perceptionBand(0);
  check('a normal nose sits at the documented baseline',
    base.floor === BASE_FLOOR && base.limit === BASE_LIMIT, base);
  check('acuity lowers the floor and raises the cap',
    perceptionBand(2).floor < base.floor && perceptionBand(2).limit > base.limit, perceptionBand(2));
  check('impairment does the reverse', perceptionBand(-2).floor > base.floor, perceptionBand(-2));
  check('the floor never goes negative, so acuity cannot loop back around',
    perceptionBand(99).floor === 0 && perceptionBand(-99).floor <= 8);
  check('even a blunted sense still gets the thing that is on fire',
    perceive([{ text: 'fire', strength: 10 }], perceptionBand(-3)).length === 1);

  // The whole point: the faint band is generated either way and only acuity reads it.
  const faint = [{ text: 'one quiet person', strength: 3 }];
  check('a lone person is below a normal nose', perceive(faint, perceptionBand(0)).length === 0);
  check('...and above a sharp one', perceive(faint, perceptionBand(2)).length === 1);

  check('a player with no statuses is baseline', (await acuityFor(p, 'smell')) === 0);

  // A status effect is the cheap path for a drug or mutation to sharpen a sense.
  const { registerStatusEffect, effectAcuity } = await import('../../server/engine/effects.js');
  registerStatusEffect({ name: 'regress_keen_nose', label: 'Keen', onTick: () => null, acuity: { smell: 2 } });
  p.statuses = [{ name: 'regress_keen_nose', duration: 5 }];
  check('a status effect can sharpen a sense with no plumbing of its own',
    effectAcuity(p, 'smell') === 2, effectAcuity(p, 'smell'));
  check('...and only the sense it names', effectAcuity(p, 'hearing') === 0);
  check('acuityFor picks the status up', (await acuityFor(p, 'smell')) === 2);
  p.statuses = [];

  // ── The stat path: dump into senses and you ARE super, no hardware ──────────
  const { statAcuity, wouldOverload, overloadThreshold, EXTREME } =
    await import('../../server/engine/senses.js');
  const savedStat = p.stat_senses, savedDom = p._senseDominant, savedSec = p._senseSecond;

  p.stat_senses = 12; p._senseDominant = 'smell'; p._senseSecond = 'hearing';
  check('a heavy senses investment makes the dominant sense super with no augment',
    statAcuity(p, 'smell') >= 3, statAcuity(p, 'smell'));
  check('...the second is only slightly better than human', statAcuity(p, 'hearing') <= 2 && statAcuity(p, 'hearing') >= 1);
  check('...and everything else stays ordinary', statAcuity(p, 'sight') === 0);
  check('you can never be super in two senses at once',
    statAcuity(p, 'hearing') < statAcuity(p, 'smell'));

  p.stat_senses = 2;
  check('below the threshold the stat does nothing at all', statAcuity(p, 'smell') === 0);
  p.stat_senses = 6;
  check('a mid investment sharpens the dominant sense but opens no second',
    statAcuity(p, 'smell') === 2 && statAcuity(p, 'hearing') === 1);

  // ── And it hurts ────────────────────────────────────────────────────────────
  check('a sharp sense is overwhelmed by something a normal one shrugs off',
    wouldOverload(4, 9) && !wouldOverload(0, 9));
  check('the sharper you are, the less it takes to blow you out',
    overloadThreshold(4) < overloadThreshold(2));
  // Nobody is immune. A sharp sense goes down to things others merely dislike;
  // an ordinary one still goes down to something at the top of the scale.
  check('an ordinary nose is NOT troubled by everyday filth', !wouldOverload(0, 9));
  check('...but an extreme event takes anyone, augment or no augment',
    wouldOverload(0, EXTREME), overloadThreshold(0));
  check('a dulled sense is the only way to walk through it unaffected',
    !wouldOverload(-3, EXTREME + 2));
  // Being blown out by a corpse and by a blocked drain are different experiences,
  // and the character whose whole build is specificity should not go vague at the
  // moment their sense fails.
  const { overloadText } = await import('../../server/engine/senses.js');
  check('overload prose names what actually did it',
    overloadText('smell', 'feces') !== overloadText('smell', 'burning'));
  check('...and differs by sense as well as by source',
    overloadText('smell', 'blood') !== overloadText('hearing', 'blood'));
  check('an untagged contributor still gets a sensible line',
    overloadText('smell', null) === overloadText('smell', 'no_such_source'));
  check('every sense has a fallback line', ['smell', 'hearing', 'sight', 'touch'].every(s => !!overloadText(s, null)));

  check('overload leaves you WORSE than an ordinary nose, not merely normal', (() => {
    p.statuses = [{ name: 'sense_overload', duration: 20 }];
    const blown = effectAcuity(p, 'smell');
    p.statuses = [];
    return blown < 0;
  })());

  // ── listen + sight: the other two senses now do something ───────────────────
  r = await run('listen');
  check('listen is a live verb and reaches the sense, not just the radio',
    /you listen|you stop, and listen/i.test(r?.message || ''), r?.message);

  // The fan-out is capped. `getSoundReach` legitimately returns 40+ zones in an
  // open district at high acuity, and each one costs a gatherHook across every
  // plugin — an uncapped, uncooldowned verb is how the query-per-sniff bug
  // happened the first time.
  const { getSoundReach } = await import('../../server/engine/sounds.js');
  const wide = getSoundReach(p.current_zone, 3 + 4 * 2);
  check('sound reach is honest about distance (uncapped at the source)', wide.size >= 1, wide.size);
  check('...but listen never interrogates more than its cap', (() => {
    const capped = [...wide.entries()].sort((a, b) => a[1] - b[1]).slice(0, 12);
    return capped.length <= 12;
  })());

  // The cap is the backstop; the INDEX is what makes it cheap. A zone nobody is
  // making noise in never reaches the gather hook at all, so a listen in an
  // empty neighbourhood costs zero plugin calls however far it reaches.
  const { markNoisy, clearNoisy, clearNoisyKey, isNoisy, noisyZoneCount } =
    await import('../../server/engine/sounds.js');
  const before = noisyZoneCount();
  check('a silent zone is skipped entirely', !isNoisy('regress-quiet-zone'));
  markNoisy('regress-quiet-zone', 'cook-1');
  check('a noise source puts its zone in the index', isNoisy('regress-quiet-zone'));
  markNoisy('regress-quiet-zone', 'cook-2');
  clearNoisy('regress-quiet-zone', 'cook-1');
  check('two sources in one room do not cancel each other', isNoisy('regress-quiet-zone'));
  clearNoisy('regress-quiet-zone', 'cook-2');
  check('the last one out clears the room', !isNoisy('regress-quiet-zone'));
  check('the index does not leak entries', noisyZoneCount() === before, noisyZoneCount());
  // A vessel can be carried out of the room it started cooking in, so a source
  // must be forgettable without knowing where it left itself.
  markNoisy('regress-zone-a', 'wanderer');
  clearNoisyKey('wanderer');
  check('a source can be cleared without knowing its zone', !isNoisy('regress-zone-a'));

  // SIGHT is not a verb — it makes `look` work in the dark. The ladder shift is
  // what "super sight" means concretely: pitch dark up to gloomy is the step
  // where enemies and NPCs stop being hidden.
  const { shiftVisibility, LIGHT_LADDER } = await import('../../server/engine/environment.js');
  const pitch = { category: 'pitch_dark', visibility: 0 };
  check('a keen eye lifts a pitch-dark room off the floor',
    LIGHT_LADDER.indexOf(shiftVisibility(pitch, 2).category) > 0, shiftVisibility(pitch, 2));
  check('super sight makes a pitch-dark room actually navigable',
    shiftVisibility(pitch, 3).category === 'gloomy', shiftVisibility(pitch, 3).category);
  check('...and at the top of the stat, comfortable',
    shiftVisibility(pitch, 4).category === 'dim', shiftVisibility(pitch, 4).category);
  check('smoked lenses push the other way', (() => {
    const clear = { category: 'clear', visibility: 0.6 };
    return LIGHT_LADDER.indexOf(shiftVisibility(clear, -2).category) < LIGHT_LADDER.indexOf('clear');
  })());
  check('the shift never falls off either end of the ladder',
    shiftVisibility(pitch, -9).category === 'pitch_dark'
      && shiftVisibility({ category: 'blazing', visibility: 1 }, 9).category === 'blazing');
  check('an ordinary eye changes nothing', shiftVisibility(pitch, 0) === pitch);

  // Touch was dropped rather than shipped as a sense you could attune to and
  // get nothing from.
  const { SENSES: LIVE_SENSES } = await import('../../server/engine/senses.js');
  check('every attunable sense has something that reads it',
    !LIVE_SENSES.includes('touch'), LIVE_SENSES);

  // ── Gear: buy protection with perception ────────────────────────────────────
  const { recomputeSenseDamp } = await import('../../server/engine/commands/inventory.js');
  const { gearDamp } = await import('../../server/engine/senses.js');
  const savedDamp = p._senseDamp;

  p.stat_senses = 12; p._senseDominant = 'smell'; p._senseSecond = null;
  const bare = await acuityFor(p, 'smell');

  recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }]);
  check('worn gear dulls the sense it names', gearDamp(p, 'smell') === -2, gearDamp(p, 'smell'));
  check('...and nothing else', gearDamp(p, 'hearing') === 0);
  const masked = await acuityFor(p, 'smell');
  check('a mask costs you real acuity', masked < bare, { bare, masked });

  // The trade, stated as a test: the mask makes you harder to overwhelm by
  // exactly as much as it makes you worse at smelling.
  check('...and buys protection with it — a crowd that would blow you out no longer can',
    wouldOverload(bare, 6) && !wouldOverload(masked, 6), { bare, masked });
  check('but it does not make you immune — something truly foul still gets through',
    wouldOverload(masked, 10), overloadThreshold(masked));

  recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }, { tags: { sense_damp: { smell: -1 } } }]);
  check('damping sums across everything worn', gearDamp(p, 'smell') === -3);
  // Two tiers per sense: plugs take the edge off, a respirator seals. Enough
  // of either and you can walk through the worst thing in the game untouched —
  // perceiving nothing, which is the price.
  check('the cheap tier alone is not enough to survive an extreme event', (() => {
    recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -1 } } }]);
    return wouldOverload(gearDamp(p, 'smell'), EXTREME + 2);
  })());
  check('...but a proper seal is', (() => {
    recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }, { tags: { sense_damp: { smell: -1 } } }]);
    return !wouldOverload(gearDamp(p, 'smell'), EXTREME + 2);
  })());
  recomputeSenseDamp(p, [{ tags: {} }, { tags: null }]);
  check('gear with no damping leaves you as you were', gearDamp(p, 'smell') === 0);

  p._senseDamp = savedDamp;
  p.stat_senses = savedStat; p._senseDominant = savedDom; p._senseSecond = savedSec;

  // The verb itself: gated on the stat, and re-attuning is surgery.
  p.stat_senses = 0;
  r = await run('attune smell');
  check('attune refuses an ordinary nervous system', /ordinary/i.test(r?.message || ''), r?.message);
  p.stat_senses = 9; p._senseDominant = null;
  r = await run('attune nonsense');
  check('attune rejects a sense that does not exist', /isn't a sense/i.test(r?.message || ''), r?.message);
  r = await run('attune smell');
  check('the first attunement is free', /comes forward/i.test(r?.message || ''), r?.message);
  r = await run('attune hearing');
  check('...but changing it is a clinic job', /clinic/i.test(r?.message || ''), r?.message);
  p.stat_senses = savedStat; p._senseDominant = savedDom; p._senseSecond = savedSec;
}
