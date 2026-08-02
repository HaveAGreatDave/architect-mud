// Tablet OS plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player's id matches no players row, so DB writes are
// no-ops; this asserts routing + payload shape, not real data.
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { world } from '../../server/engine/world.js';
import { _test as news } from './news-generator.js';
import { _test as calendar } from './calendar-app.js';

export default async function regress({ run, check, getPlayer }) {
  // ── Alarm: a clock on GAME time, set anywhere, before you sleep ─────────────
  {
    const { parseTime, minutesUntil, hhmm } = await import('../../server/engine/clock.js');
    check('alarm accepts the ways people actually type a time',
      parseTime('07:30') === 450 && parseTime('7:30') === 450
        && parseTime('0730') === 450 && parseTime('730') === 450);
    check('...and rejects what is not one',
      parseTime('') === null && parseTime('25:00') === null
        && parseTime('07:99') === null && parseTime('half seven') === null);
    check('midnight is a time', parseTime('00:00') === 0 && hhmm(0) === '00:00');
    check('the clock reads back what was set', hhmm(450) === '07:30' && hhmm(1439) === '23:59');
    // An alarm always looks FORWARD — a time already gone means tomorrow.
    check('a time later today rings today', minutesUntil(400, 450) === 50);
    check('a time already passed rings tomorrow', minutesUntil(500, 450) === 1390);
    check('setting it for right now means a full day, not instantly',
      minutesUntil(450, 450) === 1440);
  }

  let r = await run('tablet');
  check('tablet verb opens home screen', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));
  check('home screen carries player summary', !!r?.player && typeof r.player.credits === 'number', JSON.stringify(r?.player));
  check('home screen lists apps', Array.isArray(r?.apps) && r.apps.length >= 9, `apps=${r?.apps?.length}`);
  check('home screen apps include quests/skills/bank/vehicles/properties/settings/corp/specter/party/crime',
    ['quests', 'skills', 'bank', 'vehicles', 'properties', 'settings', 'corp', 'specter', 'party', 'crime']
      .every(id => r.apps.some(a => a.id === id)),
    JSON.stringify(r?.apps?.map(a => a.id)));

  // ── Kit app: the soak seam ───────────────────────────────────────────────────
  // The Kit (formerly Gear) screen must carry the server's AUTHORITATIVE per-slot
  // soak — `player.soak`, the exact structure combat routes a hit through. It was
  // silently dropped from the payload for a long time, which forced the client to
  // re-derive protection by summing `tags.armor_soak` over equipped rows: blind to a
  // `covers` garment's extra slots and to every registered armor contributor (a
  // subdermal augment grants soak with no worn item at all), so a protected player
  // read as bare. The client no longer computes this, so its absence isn't a
  // cosmetic regression — it's the whole Protection table going to zero.
  // Deliberately a LOCAL `g`, not the shared `r`: the wallpaper-sky checks further
  // down still read `r` as the home payload fetched above.
  {
    const g = await run('tabletnav gear');
    check('Kit screen is the gear app', g?.appId === 'gear' && g?.view === 'gear', JSON.stringify({ a: g?.appId, v: g?.view }));
    check('Kit screen carries per-slot soak', g?.soak && typeof g.soak === 'object', JSON.stringify(g?.soak));
    // Shape, not values — the fake player wears nothing, so an empty object is the
    // correct answer here. What must hold is that a populated slot is
    // `{ soak: { type: n } }` and never a bare `{ type: n }`, because the client
    // reads `soak[slot].soak[type]` and a flattened shape reads as zero everywhere.
    check('…in the { slot: { soak: {…} } } shape combat uses',
      Object.values(g.soak).every(v => v && typeof v === 'object' && typeof v.soak === 'object'),
      JSON.stringify(g?.soak));
    check('Kit screen still carries the tray + weights',
      Array.isArray(g?.inventory) && typeof g?.weight === 'number' && typeof g?.capacity === 'number',
      JSON.stringify({ inv: Array.isArray(g?.inventory), w: g?.weight, c: g?.capacity }));
    // The app is named Kit and the id is STILL `gear`: the id is in saved home-screen
    // layouts, every `tabletnav gear` call site, the smartbar's Inv/Gear deep links and
    // the client's `_data.appId === 'gear'` refresh check. Renaming it breaks all four.
    const kit = r.apps.find(a => a.id === 'gear');
    check('the gear app is called INV but keeps its id', kit?.name === 'INV', JSON.stringify(kit?.name));
  }

  // ── Home widgets + wallpaper sky ─────────────────────────────────────────────
  // The widget seam is contributed by apps (buildWidget) and rendered by three
  // client kinds; a card of an unknown kind is dropped by the client, so the shape
  // assertion here is what stops a widget silently vanishing. buildWidget always
  // runs server-side regardless of the client's own widgets-on/off preference (that
  // toggle is display-only) — see the contract note in plugins/tablet/index.js.
  check('home screen carries a widgets array', Array.isArray(r?.widgets), JSON.stringify(r?.widgets));
  check('every widget declares a kind the client can draw',
    (r.widgets || []).every(w => ['meters', 'stat', 'bar', 'lines'].includes(w.kind)),
    JSON.stringify((r.widgets || []).map(w => `${w.id}:${w.kind}`)));
  check('every widget names the app it opens',
    (r.widgets || []).every(w => typeof w.nav === 'string' && r.apps.some(a => a.id === w.nav)),
    JSON.stringify((r.widgets || []).map(w => w.nav)));
  {
    // There is deliberately NO vitals card — the body's numbers are metered out by
    // the Vitals screen itself, not parked on the home screen (see health-app.js).
    check('no vitals widget exists',
      !(r.widgets || []).some(w => w.id === 'vitals'),
      JSON.stringify((r.widgets || []).map(w => w.id)));
    // The beginner cards: where you are, what's in your pocket, a thing you might
    // not know. All three must be free of DB reads, which the buildWidget contract
    // enforces by convention rather than by an assertion here — this just checks
    // they exist and are drawable.
    for (const id of ['place', 'tip']) {
      const w = (r.widgets || []).find(x => x.id === id);
      check(`the ${id} widget rides along with drawable lines`,
        !!w && w.kind === 'lines' && Array.isArray(w.lines) && w.lines.length > 0
          && w.lines.every(l => typeof l.text === 'string'),
        JSON.stringify(w));
      // Glyph-led: the card has to be identifiable without being read.
      check(`the ${id} widget leads with a glyph`, !!w?.icon, JSON.stringify(w?.icon));
    }
    {
      // Pocket is DRAWN — a stacked proportion, not two printed figures.
      const w = (r.widgets || []).find(x => x.id === 'pocket');
      check('the pocket widget is a drawn proportion',
        !!w && w.kind === 'bar' && Array.isArray(w.segments) && w.segments.length === 2,
        JSON.stringify(w));
      check('its segments are drawable percentages with a tone and a label',
        (w?.segments || []).every(s => typeof s.pct === 'number' && s.pct >= 0 && s.pct <= 100
          && ['good', 'warn', 'bad'].includes(s.tone) && typeof s.label === 'string'),
        JSON.stringify(w?.segments));
      // A broke player has 0 of both — the bar must still render something rather
      // than dividing by zero into NaN.
      check('...and never NaN, even at zero credits',
        (w?.segments || []).every(s => Number.isFinite(s.pct)), JSON.stringify(w?.segments));
    }
    // Clean by default — the heat card is an alarm, so its absence is the feature.
    check('no wanted widget while the player is clean',
      !(r.widgets || []).some(w => w.id === 'heat'),
      JSON.stringify((r.widgets || []).map(w => w.id)));
  }
  check('home screen carries the wallpaper sky snapshot',
    !!r?.sky && typeof r.sky.minutes === 'number' && r.sky.minutes >= 0 && r.sky.minutes < 1440,
    JSON.stringify(r?.sky));
  check('the sky names a weather and a phase',
    typeof r.sky.weather === 'string' && !!r.sky.weather && typeof r.sky.phase === 'string',
    JSON.stringify(r?.sky));

  // ── Crime app: the rap sheet ─────────────────────────────────────────────────
  // Four screens, all windows onto other owners. The fake player is clean and has
  // never been arrested, so this also asserts the empty-state reads honestly
  // rather than throwing on absent flags/rows.
  {
    let c = await run('tabletnav crime');
    check('crime app opens on the Record screen',
      c?.appId === 'crime' && c?.activeTab === 'Record' && Array.isArray(c?.rows), JSON.stringify(c?.breadcrumb));
    check('a clean record reads as no active warrants',
      (c.rows || []).some(x => String(x.value).includes('no active warrants')),
      JSON.stringify((c.rows || []).map(x => x.label)));
    check('the record screen carries the lifetime counters',
      ['  Arrests', '  Fines paid', '  Time served', '  Offences charged'].every(l => (c.rows || []).some(x => x.label === l)),
      JSON.stringify((c.rows || []).map(x => x.label)));

    c = await run('tabletnav crime statutes');
    check('statutes screen lists the crime catalogue',
      c?.activeTab === 'Statutes' && (c.items || []).length > 10, `items=${c?.items?.length}`);
    check('statutes are ordered heaviest first',
      (() => {
        const stars = (c.items || []).map(i => Number(String(i.badgeLabel).replace('★', '')));
        return stars.every((n, k) => k === 0 || stars[k - 1] >= n);
      })(), JSON.stringify((c.items || []).slice(0, 4).map(i => i.badgeLabel)));

    c = await run('tabletnav crime priors');
    check('priors screen stands up with nothing on file',
      c?.activeTab === 'Priors' && (c.items || []).length === 1
        && String(c.items[0].label).includes('No priors'), JSON.stringify(c?.items));

    c = await run('tabletnav crime property');
    check('property screen stands up with an empty locker',
      c?.activeTab === 'Property' && (c.items || []).length === 1, JSON.stringify(c?.items));
    check('property screen says the locker is a graveyard',
      (c.rows || []).some(x => /nothing in the locker comes back/i.test(String(x.value))),
      JSON.stringify(c?.rows));

    // The Wanted card belongs to Crime now, not Surveillance — that's what lets it
    // sit on a default home screen (specter is stashed out of the box).
    const { crimeRecordOf } = await import('../surveillance/index.js');
    const rec = await crimeRecordOf(getPlayer());
    check('crimeRecordOf returns a well-formed record',
      !!rec && Array.isArray(rec.active) && Array.isArray(rec.history)
        && typeof rec.priorsTotal === 'number' && !!rec.wanted, JSON.stringify(rec));
  }

  // ── Sports card: one game, and never a score that hasn't aired ──────────────
  {
    const { dispatchAction } = await import('../../server/engine/actions.js');
    const p = getPlayer();
    const next = await dispatchAction({ type: 'broadcast.getNextOnAir', actor: p, params: {} }).catch(() => null);
    if (next) {
      check('next-on-air names both clubs and a channel slot',
        !!next.away && !!next.home && typeof next.slot === 'number', JSON.stringify(next));
      check('next-on-air is ONE game, not a fixture list', !Array.isArray(next), typeof next);
      // The whole point of the action: a fixture that has not started must not
      // carry a score, because every game is computable from its slot.
      check('an upcoming game carries NO score (the spoiler rule)',
        next.live || next.final || (next.awayScore === null && next.homeScore === null),
        JSON.stringify({ live: next.live, final: next.final, a: next.awayScore, h: next.homeScore }));
      check('a live game carries a score and a status',
        !next.live || (typeof next.awayScore === 'number' && typeof next.homeScore === 'number' && !!next.status),
        JSON.stringify(next));
      check('narrowing to one code only returns that code',
        await (async () => {
          const hk = await dispatchAction({ type: 'broadcast.getNextOnAir', actor: p, params: { sport: 'hockey' } }).catch(() => null);
          return !hk || hk.sport === 'hockey';
        })(), 'hockey filter');
    } else {
      check('next-on-air answers null rather than throwing when nothing is scheduled', true);
    }
    // The widget's ON/OFF/code filter is per-player, and 'off' must mean absent.
    await setFlag('player', 'sports_widget', 'off', p);
    const off = await run('tablet');
    check('sports card obeys the off setting',
      !(off.widgets || []).some(w => w.id === 'sports'),
      JSON.stringify((off.widgets || []).map(w => w.id)));
    await setFlag('player', 'sports_widget', 'both', p);
  }

  r = await run('os');
  check('os verb aliases tablet', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));

  // Nav into each simple app's root screen — asserts buildScreen doesn't throw
  // and returns a recognizable view.
  for (const appId of ['skills', 'bank', 'crafting', 'vehicles', 'properties', 'settings', 'corp']) {
    r = await run(`tabletnav ${appId}`);
    check(`tabletnav ${appId} routes to app`, r?.type === 'tablet_panel' && r?.screen === 'app' && r?.appId === appId, JSON.stringify(r));
    check(`tabletnav ${appId} has no error`, !r?.error, r?.error);
  }

  // Binder: the card collection. The fake player owns nothing, which is the case
  // worth pinning — an empty binder still has to render its shelves and its
  // denominator rather than dividing by zero or erroring out. The two contracts
  // are that completion is measured against the ROLLABLE set (architect cards
  // never roll, so counting them would put 100% out of reach forever) and that a
  // gap is a COUNT and never a name.
  r = await run('tabletnav binder');
  check('tabletnav binder routes to the app', r?.type === 'tablet_panel' && r?.appId === 'binder' && r?.view === 'binder',
    JSON.stringify(r)?.slice(0, 180));
  check('an empty binder renders without erroring', !r?.error && typeof r?.pct === 'number' && typeof r?.setTotal === 'number',
    JSON.stringify(r)?.slice(0, 180));
  check('the binder never names an unfilled slot',
    (r?.ranks || []).every(k => typeof k.gaps === 'number' && (k.cards || []).length === k.owned),
    JSON.stringify(r?.ranks)?.slice(0, 200));
  check('completion is measured against the rollable set only',
    !(r?.ranks || []).some(k => k.rarity === 'architect' && k.total > 0),
    JSON.stringify(r?.ranks?.map(k => `${k.rarity}:${k.total}`)));
  // A card you don't hold must not open — the detail screen is reachable only
  // from your own shelf, so a guessed id falls back to the binder rather than
  // reading somebody else's card out of the table.
  r = await run('tabletnav binder card 999999');
  check('a card you do not own falls back to the binder', r?.view === 'binder' && !r?.error, JSON.stringify(r)?.slice(0, 140));

  // Crafting app: root is a list of known recipes (skill-gated). The fake player
  // knows none, but the screen must still route as a list view with no error.
  r = await run('tabletnav crafting');
  check('crafting app root is a list view', r?.type === 'tablet_panel' && r?.appId === 'crafting' && r?.view === 'list' && !r?.error, JSON.stringify(r)?.slice(0, 200));

  // Quests app: category root (no rows for the fake player, but must not error).
  r = await run('tabletnav quests');
  check('tabletnav quests routes', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r));
  check('quests root is category view', r?.view === 'categories', JSON.stringify(r));

  // Help app: root is the chapter index (categories); a chapter opens the reader
  // (help view) with sections; the Commands chapters carry the real /help groups.
  r = await run('tabletnav help');
  check('help app root is category view', r?.type === 'tablet_panel' && r?.appId === 'help' && r?.view === 'categories', JSON.stringify(r)?.slice(0, 200));
  check('help root lists chapters', Array.isArray(r?.items) && r.items.some(it => it.id === 'basics') && r.items.some(it => it.id === 'gear'), JSON.stringify(r?.items?.map(i => i.id)));
  r = await run('tabletnav help gear');
  check('help chapter opens the reader view', r?.view === 'help' && !!r?.chapter, JSON.stringify(r)?.slice(0, 200));
  check('help chapter carries command sections', Array.isArray(r?.chapter?.sections) && r.chapter.sections.some(s => s.heading === 'COMBAT'), JSON.stringify(r?.chapter?.sections?.map(s => s.heading)));
  r = await run('tabletnav help nonsense_chapter');
  check('help unknown chapter errors cleanly', r?.view === 'error', JSON.stringify(r)?.slice(0, 120));

  // Unknown app id falls back to home rather than erroring.
  r = await run('tabletnav nonexistent_app_xyz');
  check('tabletnav unknown app falls back to home', r?.screen === 'home', JSON.stringify(r));

  // Settings app renders natively (Tablet's own theme picker, not the full
  // game settings panel) — client-side, so the server side is just the signal.
  r = await run('tabletnav settings');
  check('settings app signals tablet_settings view', r?.view === 'tablet_settings', JSON.stringify(r));

  // …with one exception: Display Mode is SERVER state (the flight plugin reads it
  // on the server at board time), so the screen has to ship its current value down
  // or the pills would render from nothing. `displaymode` is the way back.
  check('settings ships the Display Mode state', typeof r?.textDisplay === 'boolean', JSON.stringify(r)?.slice(0, 160));
  // Deliberately NOT hydrating a flag cache onto the shared fake player to make
  // this pass: `_flags` is process-wide once set, and later suites clear flags with
  // a raw DELETE that the cache never sees. The uncached read path is a real one
  // (offline players, dev tools) and is what this exercises.
  await run('displaymode text');
  r = await run('tabletnav settings');
  check('displaymode text is reflected on the settings screen', r?.textDisplay === true, JSON.stringify(r)?.slice(0, 160));
  await run('displaymode visual');
  r = await run('tabletnav settings');
  check('displaymode visual is reflected on the settings screen', r?.textDisplay === false, JSON.stringify(r)?.slice(0, 160));
  const badMode = await run('displaymode sideways');
  check('displaymode rejects anything that is not visual|text', badMode?.type === 'error', JSON.stringify(badMode)?.slice(0, 160));

  // Corp app now renders natively (reshapes plugins/corps' own
  // buildConsolePayload()). The fake player has no corp membership, so this
  // exercises the founding screen (cost warning + name prompt), not an error.
  r = await run('tabletnav corp');
  check('corp app (no membership) shows the founding screen', r?.view === 'corp_found', JSON.stringify(r));
  check('founding screen states the one-time fee', typeof r?.foundFee === 'number' && r.foundFee > 0, JSON.stringify(r));

  // Corp Territory Map sub-screen: cmdCorpMap works with or without a corp, so
  // even the no-membership fake player gets a corp_map view + a tiles array.
  r = await run('tabletnav corp map');
  check('corp map sub-screen signals corp_map view', r?.view === 'corp_map' && Array.isArray(r?.tiles), JSON.stringify(r)?.slice(0, 200));
  check('corp map sub-screen has no error', !r?.error, r?.error);

  // Codex app: the reference shelf. Its root lists the registered sections; each
  // section is its own screen, and the Orders section is the former standalone
  // Ideology app, payload-identical (see plugins/tablet/codex/section-orders.js).
  r = await run('tabletnav codex');
  check('codex app is registered on the home screen', (await run('tablet'))?.apps?.some(a => a.id === 'codex'), 'codex app missing from roster');
  check('codex root signals the codex view with no section', r?.type === 'tablet_panel' && r?.appId === 'codex' && r?.view === 'codex' && !r?.section, JSON.stringify(r)?.slice(0, 160));
  check('codex shelf carries its sections', Array.isArray(r?.sections) && ['quiet', 'basin', 'orders'].every(id => r.sections.some(s => s.id === id)), JSON.stringify(r?.sections)?.slice(0, 200));

  // Volume I is granted whole by the prologue, so a fake player who never ran it
  // sees the chapters sealed — and a sealed chapter must ship NO body.
  r = await run('tabletnav codex quiet');
  check('codex volume routes to a chapters section', r?.view === 'codex' && r?.section === 'quiet' && r?.sectionKind === 'chapters', JSON.stringify(r)?.slice(0, 160));
  check('codex volume carries chapters with progress', Array.isArray(r?.chapters) && r.chapters.length > 0 && r?.progress && typeof r.progress.total === 'number', `chapters=${r?.chapters?.length}`);
  const sealed = (r?.chapters || []).filter(c => !c.unlocked);
  check('sealed chapters never ship their prose', sealed.every(c => c.body == null), JSON.stringify(sealed[0])?.slice(0, 160));
  check('sealed chapters carry a hint instead', sealed.every(c => !c.hint || typeof c.hint === 'string'), 'hint should be a string when present');

  // The Orders section — the alignment reader, unchanged by the move. The fake
  // player has no rep, so every order sits at the base tier.
  r = await run('tabletnav codex orders');
  check('codex orders section signals kind orders', r?.view === 'codex' && r?.section === 'orders' && r?.sectionKind === 'orders', JSON.stringify(r)?.slice(0, 160));
  // Count-agnostic: the four canon orders must be present and live (not tagged
  // expansion). Expansion orders may or may not be imported locally, so assert
  // presence of the canon set rather than an exact length.
  const canonLive = ['ideology_ascendants', 'ideology_long_watch', 'ideology_wildblood', 'ideology_exodus'];
  check('ideology payload carries the live canon orders', Array.isArray(r?.orders) && canonLive.every(id => r.orders.some(o => o.id === id && !o.expansion)), `orders=${r?.orders?.length}`);
  check('ideology payload carries the tier ladder', Array.isArray(r?.tiers) && r.tiers.length === 6, `tiers=${r?.tiers?.length}`);
  check('ideology overview carries stance + paths', r?.overview && typeof r.overview.stance === 'number' && !!r.overview.paths, JSON.stringify(r?.overview));
  check('ideology orders carry standing + profile + expansion fields', r?.orders?.every(o => o.id && o.color && typeof o.rep === 'number' && 'stance' in o && 'path' in o && 'expansion' in o && Array.isArray(o.opposed)), JSON.stringify(r?.orders?.[0])?.slice(0, 200));

  // The `codex` verb is the same door as the app tile.
  r = await run('codex');
  check('codex verb opens the shelf', r?.type === 'tablet_panel' && r?.appId === 'codex' && r?.view === 'codex', JSON.stringify(r)?.slice(0, 160));

  // ── Every sealed chapter must be reachable ─────────────────────────────────
  // The one failure mode that would never surface in play: a chapter that ships
  // with a hint and no way in. A locked chapter counts as reachable if it has an
  // in-code trigger (codex-app.js) OR a CODEX_UNLOCK authored on some NPC's
  // dialogue. Scanning the LIVE npcs (not the content files) also proves the
  // authoring actually imported.
  {
    const { CHAPTERS } = await import('./codex/chapters.js');
    const CODE_TRIGGERED = new Set(['inheritance', 'wants', 'answers', 'chrome', 'flesh', 'mind']);
    const authored = new Set();
    for (const npc of world.npcs.values()) {
      const tree = npc.dialogue_tree;
      if (!tree || typeof tree !== 'object') continue;
      for (const node of Object.values(tree)) {
        const all = [...(node?.actions || []), ...(node?.options || []).flatMap(o => o.actions || [])];
        for (const a of all) if (a?.action === 'CODEX_UNLOCK' && a.chapter) authored.add(a.chapter);
      }
    }
    const locked = CHAPTERS.filter(c => c.locked);
    const orphans = locked.filter(c => !authored.has(c.id) && !CODE_TRIGGERED.has(c.id));
    check('every sealed chapter has a way in', orphans.length === 0, `unreachable: ${orphans.map(c => c.id).join(', ')}`);
    check('every sealed chapter has an NPC who explains it', locked.every(c => authored.has(c.id)),
      `no dialogue unlock for: ${locked.filter(c => !authored.has(c.id)).map(c => c.id).join(', ')}`);
    // And nobody is authoring an unlock for a chapter that doesn't exist — a typo
    // in a dialogue tree would otherwise be a silently dead conversation branch.
    const known = new Set(CHAPTERS.map(c => c.id));
    check('no dialogue unlocks a chapter that does not exist', [...authored].every(id => known.has(id)),
      `unknown chapter ids in dialogue: ${[...authored].filter(id => !known.has(id)).join(', ')}`);
  }

  // CODEX_UNLOCK itself: the authoring seam VINE calls. The fake player's flag
  // writes are no-ops against the DB, so assert the action's own contract —
  // a real chapter is accepted, a typo is refused rather than silently ignored.
  {
    const { dispatchAction } = await import('../../server/engine/actions.js');
    const p = getPlayer();
    const ok = await dispatchAction({ type: 'CODEX_UNLOCK', actor: p, params: { chapter: 'chrome', quiet: true } });
    check('CODEX_UNLOCK accepts a real chapter', ok?.type === 'codex' && ok.chapter === 'chrome', JSON.stringify(ok));
    const bad = await dispatchAction({ type: 'CODEX_UNLOCK', actor: p, params: { chapter: 'not_a_chapter' } });
    check('CODEX_UNLOCK refuses an unknown chapter', bad?.type === 'error', JSON.stringify(bad));
  }

  // Map app: the tablet-native city map. Reuses buildMapPayload, so the root
  // resolves to a map view with a tiles array + mode; the unified zoom ladder
  // (z<n> args) widens the tile window until it saturates into the regional view.
  r = await run('tabletnav map');
  check('map app routes to a map view', r?.type === 'tablet_panel' && r?.appId === 'map' && r?.view === 'map', JSON.stringify(r)?.slice(0, 200));
  check('map app carries tiles + mode with no error', Array.isArray(r?.tiles) && typeof r?.mode === 'string' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  check('map app reports the zoom ladder (zoomLevel + maxZoom)', typeof r?.zoomLevel === 'number' && typeof r?.maxZoom === 'number' && r.maxZoom >= 1, JSON.stringify({ z: r?.zoomLevel, m: r?.maxZoom }));
  const z0Count = r?.tiles?.length || 0;
  r = await run('tabletnav map z1');
  check('map app z1 is a wider window than z0', r?.view === 'map' && r?.mode === 'zone' && r?.zoomLevel === 1 && (r?.tiles?.length || 0) >= z0Count, JSON.stringify({ z0: z0Count, z1: r?.tiles?.length }));
  r = await run('tabletnav map regional');
  check('map app regional is the terminal zoom stop', r?.view === 'map' && r?.mode === 'regional' && r?.zoomLevel === r?.maxZoom, JSON.stringify({ v: r?.view, z: r?.zoomLevel, m: r?.maxZoom }));

  // Party app: the fake player is in no party and has no invites, so the root is
  // the "start a party" detail view (with an invite picker if anyone's online).
  r = await run('tabletnav party');
  check('party app routes to a detail view', r?.type === 'tablet_panel' && r?.appId === 'party' && r?.view === 'detail' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  check('party app root invites you to start a party', /not in a party/i.test(r?.detail?.desc || ''), JSON.stringify(r?.detail)?.slice(0, 160));

  // Frontier app: the void-travel topology (charted/survived routes), fogged.
  r = await run('tabletnav frontier');
  check('frontier app routes to a detail view', r?.type === 'tablet_panel' && r?.appId === 'frontier' && r?.view === 'detail' && !r?.error, JSON.stringify(r)?.slice(0, 160));
  check('frontier app names the frontier map', /frontier/i.test(r?.detail?.name || ''), JSON.stringify(r?.detail)?.slice(0, 120));

  // Calendar app: root is a month-grid calendar view leading with a weeks grid and
  // an agenda list beneath it (led by the "today" marker), carrying a new-reminder
  // action. Adding a +N reminder persists to player_flags, then shows in the agenda
  // list and gets a marker dot on its grid day; drilling in (client sends the
  // breadcrumb as screenId + the id as params) opens a detail with a delete action;
  // delete removes it. Prev/next month arrows re-nav to a 'YYYY-MM' via screenId 'month'.
  const cal = getPlayer();
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [cal.id, 'calendar_reminders']);
  r = await run('tabletnav calendar');
  check('calendar app routes to a calendar view', r?.type === 'tablet_panel' && r?.appId === 'calendar' && r?.view === 'calendar' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  check('calendar view carries a weeks grid + month nav', Array.isArray(r?.weeks) && r.weeks.length > 0 && /^\d{4}-\d{2}$/.test(r?.prevMonth || '') && /^\d{4}-\d{2}$/.test(r?.nextMonth || ''), JSON.stringify({ w: r?.weeks?.length, p: r?.prevMonth, n: r?.nextMonth }));
  check('calendar agenda leads with the today marker', r?.items?.[0]?.id === 'today', JSON.stringify(r?.items)?.slice(0, 200));
  check('calendar view offers a new-reminder action', Array.isArray(r?.actions) && r.actions.some(a => a.id === 'add' && a.prompt), JSON.stringify(r?.actions)?.slice(0, 200));

  // A month nav (screenId 'month' + a 'YYYY-MM' token) returns that month's grid.
  r = await run('tabletnav calendar month 2099-01');
  check('month nav returns the requested month grid', r?.view === 'calendar' && /Janufizz 2099/.test(r?.monthLabel || ''), JSON.stringify({ v: r?.view, m: r?.monthLabel }));

  r = await run('tabletaction calendar add 2099-01-01 Regress reminder');
  check('adding a dated reminder returns the calendar (no error)', r?.appId === 'calendar' && r?.view === 'calendar' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  const remItem = r?.items?.find(it => String(it.id).startsWith('rem_'));
  check('the new reminder shows in the calendar agenda', !!remItem && /Regress reminder/.test(remItem.label), JSON.stringify(r?.items)?.slice(0, 240));

  // Drill in the way the client does: `tabletnav calendar <breadcrumb> <id>`.
  r = await run(`tabletnav calendar Calendar ${remItem?.id}`);
  check('opening a reminder routes to a detail with a delete action', r?.view === 'detail' && r?.actions?.some(a => a.id === 'del'), JSON.stringify(r)?.slice(0, 200));

  r = await run(`tabletaction calendar del ${remItem?.id}`);
  const stillThere = (r?.items || []).some(it => it.id === remItem?.id);
  check('deleting a reminder removes it from the agenda', r?.view === 'calendar' && !stillThere, JSON.stringify(r?.items)?.slice(0, 200));

  r = await run('tabletaction calendar add nodatehere just some text');
  check('a reminder with no leading date errors cleanly', r?.view === 'error', JSON.stringify(r)?.slice(0, 160));
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [cal.id, 'calendar_reminders']);

  // Day-of ping selection (dueReminders): fires today/overdue & unfired only.
  {
    const today = '2087-07-13';
    const list = [
      { id: 'a', date: '2087-07-20', text: 'future' },
      { id: 'b', date: '2087-07-13', text: 'today' },
      { id: 'c', date: '2087-07-01', text: 'overdue' },
      { id: 'd', date: '2087-07-01', text: 'already pinged', fired: true },
    ];
    const due = calendar.dueReminders(list, today).map(r => r.id).sort();
    check('dueReminders fires today + overdue, skips future + already-fired', JSON.stringify(due) === JSON.stringify(['b', 'c']), JSON.stringify(due));
    check('dueReminders is empty with no game date', calendar.dueReminders(list, null).length === 0);
  }

  // Surveillance (SPECTER) app: the fake player hasn't installed SPECTER, so the
  // hub screen is the locked state (view surveillance, live:false); installing it
  // (the flag the hack-deck program sets) unlocks the live hub. Microreels is the
  // install-free list path (empty, no error). All must route without throwing.
  const sp = getPlayer();
  await setFlag('player', 'specter_installed', '0', sp);
  r = await run('tabletnav specter');
  check('specter app routes to a surveillance view', r?.type === 'tablet_panel' && r?.appId === 'specter' && r?.view === 'surveillance', JSON.stringify(r)?.slice(0, 200));
  check('specter hub is locked until SPECTER is installed', r?.locked === true && r?.live !== true, JSON.stringify(r)?.slice(0, 200));
  await setFlag('player', 'specter_installed', '1', sp);
  r = await run('tabletnav specter');
  check('specter hub unlocks once SPECTER is installed', r?.view === 'surveillance' && r?.locked !== true && r?.live === true, JSON.stringify(r)?.slice(0, 200));
  await setFlag('player', 'specter_installed', '0', sp);
  r = await run('tabletnav specter chips');
  check('specter microreels is a list view with no error', r?.view === 'list' && !r?.error && Array.isArray(r?.items), JSON.stringify(r)?.slice(0, 200));

  // Microreels are possession-gated: a reel is the datachip you carry. Seed a clip
  // row + its datachip in the player's kit; a reel opens the app's OWN inline viewer
  // (view: reel).
  const REEL_ID = 'clip_regress_tablet';
  const CHIP_ID = `item_datachip_${REEL_ID}`;
  await query('DELETE FROM security_clips WHERE id=$1', [REEL_ID]);
  await query('DELETE FROM player_inventory WHERE item_id=$1', [CHIP_ID]);
  await query('DELETE FROM items WHERE id=$1', [CHIP_ID]);
  await query(
    `INSERT INTO security_clips (id, device_id, zone_id, owner_id, frames, captured_at, crime_tags)
     VALUES ($1,'dev_x','zone_x',$2,$3,0,'[]')`,
    [REEL_ID, sp.id, JSON.stringify([{ t: '00:00:00', text: 'Kaz says hi', kind: 'say' }, { t: '00:00:05', text: 'Vann leaves', kind: 'event' }])]
  );
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,'Datachip — Regress','','evidence',60,40,$2) ON CONFLICT (id) DO NOTHING`,
    [CHIP_ID, JSON.stringify({ datachip: true, clip_id: REEL_ID })]
  );
  await reloadItem(CHIP_ID);
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition)
     VALUES ('11111111-1111-1111-1111-111111111111',$1,$2,1,1.0)`,
    [sp.id, CHIP_ID]
  );
  r = await run('tabletnav specter chips');
  check('microreels list surfaces the carried reel', r?.view === 'list' && r.items.some(it => it.id === REEL_ID), JSON.stringify(r?.items)?.slice(0, 200));
  r = await run(`tabletnav specter microreels ${REEL_ID}`);
  check('opening a reel routes to the inline reel viewer', r?.view === 'reel' && Array.isArray(r?.reel?.frames) && r.reel.frames.length === 2, JSON.stringify(r)?.slice(0, 200));
  check('reel frames carry kind for speech/emote colouring', r?.reel?.frames?.[0]?.kind === 'say' && r?.reel?.frames?.[1]?.kind === 'event', JSON.stringify(r?.reel?.frames)?.slice(0, 160));
  await query('DELETE FROM security_clips WHERE id=$1', [REEL_ID]);
  await query('DELETE FROM player_inventory WHERE item_id=$1', [CHIP_ID]);
  await query('DELETE FROM items WHERE id=$1', [CHIP_ID]);
  deleteItemCache(CHIP_ID);

  // The Clear action delegates to the `wipe` verb and re-renders the hub — even
  // with no deployed cam it returns a surveillance view without throwing.
  r = await run('tabletaction specter clear');
  check('specter clear action returns a surveillance view', r?.type === 'tablet_panel' && r?.appId === 'specter' && r?.view === 'surveillance' && !r?.error, JSON.stringify(r)?.slice(0, 200));

  // Turn-in is an IN-PERSON hand-in: standing in the giver's zone brings up their
  // dialogue and closes the tablet (root node fires TURN_IN on render + pays out,
  // action returns { type: 'tablet_close' }); away from the giver it refuses and
  // routes there instead of completing remotely. Put the NPC in its own zone to
  // prove both halves.
  const TQ = 'quest_regress_tabletturnin';
  const TN = 'npc_regress_tabletturnin';
  const player = getPlayer();
  const savedZone = player.current_zone;
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Tablet Turn-In','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    [TQ, JSON.stringify([{ type: 'visit', zone: 'zone_regress_tabletturnin_elsewhere', count: 1, desc: 'Go elsewhere' }])]
  );
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,dialogue_tree,home_zone)
     VALUES ($1,'Regress Tablet Turn-In NPC','','zone_regress_tabletturnin_faraway',$2,'zone_regress_tabletturnin_faraway')
     ON CONFLICT (id) DO UPDATE SET dialogue_tree=$2, zone_id=$3, home_zone=$3`,
    [TN, JSON.stringify({ root: { text: 'Hi.', actions: [{ action: 'TURN_IN', quest_id: TQ }], options: [] } }), 'zone_regress_tabletturnin_faraway']
  );
  // The turn-in path reads NPCs from world.npcs (write funnel) — mirror the seed.
  world.npcs.set(TN, {
    id: TN, name: 'Regress Tablet Turn-In NPC', description: '',
    zone_id: 'zone_regress_tabletturnin_faraway', home_zone: 'zone_regress_tabletturnin_faraway',
    dialogue_tree: { root: { text: 'Hi.', actions: [{ action: 'TURN_IN', quest_id: TQ }], options: [] } },
    vendor_inventory: [], wander_zones: [], behaviour_graph: {}, flags: {}, banter: [], _ai: {},
  });
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query(
    "INSERT INTO player_quests (player_id,quest_id,status,progress) VALUES ($1,$2,'completed','[1]')",
    [player.id, TQ]
  );

  // Away from the giver: the hand-in is refused (routed, not completed) — the
  // tablet stays on the quest detail and the quest is still 'completed', not
  // 'turned_in'.
  player.current_zone = savedZone;
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in away from the giver refuses (stays on the tablet, no hand-in)', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r)?.slice(0, 200));
  const { rows: notYet } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  check('turn-in away from the giver does NOT complete the quest', notYet[0]?.status === 'completed', JSON.stringify(notYet));

  // In the giver's zone: the dialogue opens, the tablet closes, and the quest pays
  // out / turns in.
  player.current_zone = 'zone_regress_tabletturnin_faraway';
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in in the giver zone brings up the dialogue and closes the tablet', r?.type === 'tablet_close', JSON.stringify(r)?.slice(0, 200));
  const { rows: turned } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  check('turn-in via dialogue pays out / completes the quest', turned[0]?.status === 'turned_in', JSON.stringify(turned));

  // Anti-stuck guarantee: a completed quest with NO NPC tied to it (the giver was
  // deleted, or it's a self-landing flight contract) must still turn in — it falls
  // through to the direct grant rather than dead-ending. Remove the NPC and retry.
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  world.npcs.delete(TN);
  await query("UPDATE player_quests SET status='completed' WHERE player_id=$1 AND quest_id=$2", [player.id, TQ]);
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in with no NPC falls through to the direct grant (never stuck)', r?.type === 'tablet_panel' && r?.view !== 'error', JSON.stringify(r)?.slice(0, 200));

  player.current_zone = savedZone;
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  world.npcs.delete(TN);
  await query('DELETE FROM quests WHERE id=$1', [TQ]);

  // Word on the Street (news-generator getStories) must never surface a duplicate
  // headline — the live ring dedupes on record, and the assembled feed dedupes
  // live vs. tabloid filler.
  news.record('Regress News Dupe Headline'); // same headline recorded twice…
  news.record('Regress News Dupe Headline');
  const ringCopies = news.RING.filter(s => s.headline === 'Regress News Dupe Headline').length;
  check('recording the same headline twice keeps one ring copy', ringCopies === 1, `copies=${ringCopies}`);
  const stories = await news.getStories(12);
  const heads = stories.map(s => String(s.headline).trim().toLowerCase());
  check('getStories returns no duplicate headlines', heads.length === new Set(heads).size, JSON.stringify(heads));

  // ── Library app ───────────────────────────────────────────────────────────
  // The book texts are hundreds of KB, so the shelf must never touch `chapters`
  // and a page turn must index INTO the jsonb rather than pulling the array.
  // Both of those are one silent typo away from breaking, and neither shows up
  // as an exception — the shelf just gets slow, or every page reads blank.
  const { rows: shelfRows } = await query(
    `SELECT id, jsonb_array_length(chapters) AS chapters FROM books ORDER BY year`
  );
  if (!shelfRows.length) {
    check('library: books table is populated (run scripts/content/fetch-books.mjs)', false, '0 rows');
  } else {
    check('library: every book has chapters', shelfRows.every(b => b.chapters > 0),
      JSON.stringify(shelfRows));

    // THE CAST. `chapters->$2` binds the index as TEXT, and `jsonb -> text` is a
    // key lookup, not an array index — it returns NULL for every chapter of every
    // book, with no error. This asserts the ::int form actually indexes.
    const probe = shelfRows[0];
    const { rows: chRows } = await query(
      `SELECT chapters->($2::int)->>'text' AS text FROM books WHERE id=$1`,
      [probe.id, 0]
    );
    check('library: a chapter reads by integer index (the ::int cast)',
      !!chRows[0]?.text && chRows[0].text.length > 100, JSON.stringify(chRows[0])?.slice(0, 80));

    // The uncast form is the bug — if this ever starts returning text, Postgres
    // changed under us and the cast comment needs revisiting.
    const { rows: badRows } = await query(
      `SELECT chapters->$2->>'text' AS text FROM books WHERE id=$1`, [probe.id, 0]
    );
    check('library: the uncast form is still the trap it was documented as',
      badRows[0]?.text == null, JSON.stringify(badRows[0])?.slice(0, 80));

    // Out-of-range must be null, not an error — the reader clamps, but a bad
    // deep link shouldn't 500.
    const { rows: oob } = await query(
      `SELECT chapters->($2::int)->>'text' AS text FROM books WHERE id=$1`,
      [probe.id, 9999]
    );
    check('library: an out-of-range chapter is null, not an error', oob[0]?.text == null);

    r = await run('tabletnav library');
    check('library app routes', r?.type === 'tablet_panel', JSON.stringify(r)?.slice(0, 120));
  }

  // ── Vitals app ────────────────────────────────────────────────────────────
  // The fake player has no inventory and no drug history, so this asserts the
  // three tabs build and the empty cases answer cleanly instead of throwing.
  {
    r = await run('vitals');
    check('vitals verb opens the health app',
      r?.type === 'tablet_panel' && r?.appId === 'health' && r?.view === 'health', JSON.stringify(r)?.slice(0, 140));
    check('vitals defaults to the readings tab', r?.tab === 'vitals' && r?.activeTab === 'vitals', r?.tab);
    check('vitals has no error', !r?.error, r?.error);

    // Every meter must carry a band the client knows how to colour — an unknown
    // band renders as an invisible bar, which is worse than a wrong number.
    const BANDS = ['good', 'warn', 'bad', 'crit'];
    check('vitals meters cover the ones that ARE numbers',
      ['hp', 'stamina', 'radiation', 'temp', 'fatigue'].every(k => r.meters?.some(m => m.key === k)),
      JSON.stringify(r?.meters?.map(m => m.key)));
    check('every meter has a renderable band and a 0-100 fill',
      (r.meters || []).every(m => BANDS.includes(m.band) && m.pct >= 0 && m.pct <= 100),
      JSON.stringify(r?.meters?.map(m => [m.key, m.band, m.pct])));
    // Withheld on purpose: sanity is never a percentage (the sanity system tells you
    // by what you see), and hunger/thirst are words rather than a bar you can play.
    check('there is no sanity meter', !(r.meters || []).some(m => m.key === 'sanity'),
      JSON.stringify(r?.meters?.map(m => m.key)));
    check('hunger and thirst are not meters',
      !(r.meters || []).some(m => m.key === 'hunger' || m.key === 'thirst'),
      JSON.stringify(r?.meters?.map(m => m.key)));
    check('hunger and thirst come through as word readouts',
      Array.isArray(r?.readouts) && ['hunger', 'thirst'].every(k => r.readouts.some(x => x.key === k)),
      JSON.stringify(r?.readouts));
    check('every readout is a phrase with a colourable band and NO number',
      (r.readouts || []).every(x => typeof x.text === 'string' && x.text && BANDS.includes(x.band)
        && x.pct === undefined && !/\d/.test(x.text)),
      JSON.stringify(r?.readouts));
    check('afflictions is a list, empty or otherwise', Array.isArray(r?.afflictions));
    // The quick strip is contextual: it may only ever offer something the player
    // is genuinely carrying, and every offer must be usable as-is.
    check('every quick remedy names a carried item type',
      Array.isArray(r?.quick) && r.quick.every(q => q.id && q.name && q.label && q.qty > 0),
      JSON.stringify(r?.quick));

    const vitals = r;
    r = await run('health apothecary');
    check('health verb aliases vitals and takes a tab',
      r?.appId === 'health' && r?.tab === 'apothecary', JSON.stringify(r)?.slice(0, 120));
    // Don't assert WHICH items: the fake player's pack is whatever earlier plugin
    // suites left in it. Assert the shape and the invariants instead.
    check('apothecary builds a remedy list without erroring',
      Array.isArray(r?.remedies) && !r?.error, JSON.stringify(r?.remedies)?.slice(0, 200));
    // The quick strip may only ever offer something the apothecary can see —
    // otherwise a button fires a `use` for an item that isn't there.
    const shelf = new Set((r.remedies || []).map(x => x.id));
    check('every quick remedy is an item the apothecary also lists',
      (vitals.quick || []).every(q => shelf.has(q.id)),
      `quick=${JSON.stringify(vitals.quick?.map(q => q.id))} shelf=${JSON.stringify([...shelf])}`);
    // The filter is the point of the screen — a carried weapon is not medicine.
    check('apothecary rows are all remedies, each with an effect line and a kind',
      (r.remedies || []).every(x => x.effect && ['medical', 'compound', 'sustenance'].includes(x.kind)),
      JSON.stringify(r?.remedies?.map(x => [x.id, x.kind])));
    check('apothecary excludes non-medical carry',
      !(r.remedies || []).some(x => /knife|pistol|bat\b/i.test(x.name || '')),
      JSON.stringify(r?.remedies?.map(x => x.name)));

    r = await run('tabletnav health substances');
    check('substances tab builds', r?.tab === 'substances' && Array.isArray(r?.substances) && !r?.error,
      JSON.stringify(r)?.slice(0, 120));
    // The tab is now TWO questions: what has been through me (experience) and
    // what am I carrying (on hand). Both must always be present, even empty.
    check('substances tab carries an on-hand list', Array.isArray(r?.onHand), JSON.stringify(r?.onHand));

    // KNOWLEDGE IS EARNED, and the gate lives on the SERVER — an unlearned fact
    // must never be in the payload at all. A value the client is merely trusted
    // not to render is readable in devtools, which is not a secret.
    const { DRUG_FACTS } = await import('../../server/engine/drugs.js');
    check('every learnable fact has a distinct bit',
      new Set(Object.values(DRUG_FACTS)).size === Object.keys(DRUG_FACTS).length
      && Object.values(DRUG_FACTS).every(v => Number.isInteger(v) && v > 0 && (v & (v - 1)) === 0),
      JSON.stringify(DRUG_FACTS));
    for (const s of (r.substances || [])) {
      const l = s.learned || {};
      check(`unlearned facts are withheld server-side (${s.name})`,
        ((l.mask & DRUG_FACTS.EFFECTS)   || l.effects === null)
        && ((l.mask & DRUG_FACTS.DURATION)  || l.durationSeconds === null)
        && ((l.mask & DRUG_FACTS.OVERDOSE)  || l.overdoseCeiling === null)
        && ((l.mask & DRUG_FACTS.WITHDRAWAL) || l.withdrawal === null),
        JSON.stringify(l));
    }

    // An unknown tab must fall back to the readings, not blank the screen.
    r = await run('tabletnav health nonsense');
    check('an unknown tab falls back to the readings', r?.tab === 'vitals' && !r?.error, r?.tab);

    // Use with no item is a no-op that still returns a screen (a mis-fired button
    // must not leave the player staring at a dead panel).
    r = await run('tabletaction health use');
    check('a use action with no item still returns a screen',
      r?.type === 'tablet_panel' && r?.view === 'health', JSON.stringify(r)?.slice(0, 120));
  }

  // ── Storefront app ────────────────────────────────────────────────────────
  // The fake player owns no shop, so this asserts the empty case answers cleanly
  // rather than throwing on an undefined deed.
  r = await run('tabletnav storefront');
  check('storefront app routes with no shop owned', r?.type === 'tablet_panel', JSON.stringify(r)?.slice(0, 120));

  // ── Library: tapping a book must OPEN it ───────────────────────────────────
  // The bug this guards: the client builds a list tile's nav from the last
  // breadcrumb entry, and the shelf returned an EMPTY breadcrumb — so the book id
  // arrived in the screen slot with no params, matched no branch, and re-rendered
  // the shelf. Tapping a book did nothing at all.
  //
  // Asserted from BOTH directions, because either alone would pass while the app
  // stayed broken: the shelf must carry a breadcrumb (so the client routes the id
  // into params), AND the app must still open the book if an id arrives in the
  // screen slot anyway.
  {
    r = await run('tabletnav library');
    check('library shelf routes', r?.type === 'tablet_panel' && !r?.error, JSON.stringify(r)?.slice(0, 120));
    check('the shelf carries a breadcrumb (or tiles cannot route)',
      Array.isArray(r?.breadcrumb) && r.breadcrumb.length > 0, JSON.stringify(r?.breadcrumb));

    const firstBook = (r?.books || []).find(b => b.id)?.id;
    if (firstBook) {
      // The route a tile click actually produces now.
      const viaParams = await run(`tabletnav library library ${firstBook}`);
      check('a book opens when its id arrives as params',
        viaParams?.libKind === 'cover' && !viaParams?.error, JSON.stringify(viaParams)?.slice(0, 140));
      // The route it produced BEFORE the fix — must also work, not silently
      // fall through to the shelf.
      const viaScreen = await run(`tabletnav library ${firstBook}`);
      check('a book opens when its id arrives as the screen',
        viaScreen?.libKind === 'cover' && !viaScreen?.error, JSON.stringify(viaScreen)?.slice(0, 140));
      check('the two routes open the SAME book',
        viaParams?.book?.title === viaScreen?.book?.title,
        `${viaParams?.book?.title} vs ${viaScreen?.book?.title}`);

      // The contents page, and then a TAP on one of its entries. A tile click sends
      // the screen you are currently on ('Contents') plus the tile id, so a chapter
      // arrives as `contents <bookId> <idx>` — which used to look up a book called
      // "<bookId> 2" and answer "No such book." for every chapter of every book.
      const toc = await run(`tabletnav library contents ${firstBook}`);
      check('contents lists chapters',
        toc?.libKind === 'contents' && (toc.chapters || []).length > 0,
        JSON.stringify(toc)?.slice(0, 140));
      const nth = (toc?.chapters || [])[2] || (toc?.chapters || [])[0];
      if (nth) {
        const page = await run(`tabletnav library contents ${nth.id}`);
        check('tapping a contents entry opens THAT chapter',
          page?.view === 'detail' && !!page?.detail?.body,
          JSON.stringify(page)?.slice(0, 140));
        check('the chapter opened is the one that was tapped',
          page?.detail?.desc?.includes(` ${(toc.chapters.indexOf(nth) + 1)} of `),
          `${page?.detail?.desc} for entry ${nth.id}`);
      }
      // Every entry in a contents page must carry a title — a jsonb path query
      // silently drops untitled elements and shifts every index after it.
      check('every contents entry has a title and a length',
        (toc?.chapters || []).every(c => c.title && c.mins >= 1),
        JSON.stringify((toc?.chapters || []).filter(c => !c.title || !(c.mins >= 1))).slice(0, 140));
    } else {
      check('library shelf has books to open', false, 'no book ids on the shelf');
    }
  }

  // ── Sports app ─────────────────────────────────────────────────────────────
  // A season that has not been played is the NORMAL state on a fresh world, so
  // every screen has to answer cleanly with an empty league rather than throwing
  // on an undefined table — which is exactly what a regress DB looks like.
  {
    r = await run('tabletnav sports');
    check('sports app routes', r?.type === 'tablet_panel' && !r?.error, JSON.stringify(r)?.slice(0, 140));
    check('sports opens on a league table', r?.view === 'list' && Array.isArray(r?.items), JSON.stringify(r)?.slice(0, 140));
    // Never an empty screen: an unplayed league still says so on a row.
    check('an unplayed league still renders a row', (r?.items || []).length > 0, String((r?.items || []).length));
    check('both codes are offered as tabs', (r?.tabs || []).length === 2, JSON.stringify(r?.tabs));

    r = await run('tabletnav sports cluster_puck');
    check('the hockey tab routes', r?.type === 'tablet_panel' && !r?.error, JSON.stringify(r)?.slice(0, 140));
    check('the hockey tab is the hockey league', /CPhL/.test(r?.boardName || ''), r?.boardName);
    // Cluster Puck reported as "missing" — the cause was the client swallowing
    // tabs on a list view, but assert the DATA side too so a genuinely empty
    // hockey league is distinguishable from an unreachable one next time.
    check('the hockey tab offers a way back to the other code',
      (r?.tabs || []).some(t => /Deadball/i.test(t.label || '')), JSON.stringify(r?.tabs));
    check('the hockey tab marks itself active',
      /cluster/i.test(String(r?.activeTab || '')), String(r?.activeTab));

    // An unknown tab must fall back to a league, not blank the screen — the same
    // rule the health app follows.
    r = await run('tabletnav sports nonsense');
    check('an unknown code falls back to a league', r?.view === 'list' && !r?.error, JSON.stringify(r)?.slice(0, 120));

    // A team card for a club that has never played must still answer.
    r = await run('tabletnav sports deadball Nobody');
    check('a team card renders for an unknown club', r?.view === 'detail' && !r?.error, JSON.stringify(r)?.slice(0, 140));
    // THE SPOILER RULE. A future fixture is computable — every game is a pure
    // function of its slot — so the card must never print a score for a game that
    // has not aired. This asserts the card carries no score field at all for the
    // upcoming game, which is the only way to be sure one can't leak into the UI.
    const nextRow = (r?.detail?.rows || []).find(x => x.label === 'Next game');
    check('an upcoming fixture never shows a score',
      !nextRow || !/\d+\s*[–-]\s*\d+/.test(String(nextRow.value)), JSON.stringify(nextRow));
  }

  // ── News: the blotter replaced the standings box ───────────────────────────
  {
    r = await run('tabletnav news');
    const types = (r?.sections || []).map(s => s.type);
    check('news renders sections', Array.isArray(r?.sections), JSON.stringify(types));
    check('the police blotter is on the front page', types.includes('blotter'), JSON.stringify(types));
    check('the standings box has left the front page', !types.includes('standings'), JSON.stringify(types));
    const blot = (r?.sections || []).find(s => s.type === 'blotter');
    // A quiet night is a real answer — it must say so rather than render nothing.
    check('an empty blotter still says something',
      !!blot && ((blot.entries || []).length > 0 || !!blot.quiet), JSON.stringify(blot)?.slice(0, 140));
  }
}
