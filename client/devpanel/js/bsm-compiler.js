// bsm-compiler.js — .bsm broadcast script → VINE graph + flat messages + assets
// Client-side only. Functions land in global scope.

function compileBsm(text) {
  const lines = text.split('\n');
  let i = 0;

  const meta = { name: '', channel: '', category: 'general', host: '', length: null, type: 'live', location: '', sport: '', announcer: '', meteorologist: '', airSlots: null, anchors: [], reporters: [], sidekick: '', guestNpc: '', cohost: '', rounds: null, subject: '', presents: '', rating: '', director: '', airDays: [] };
  const _debug = { unknownDirectives: [], nodeTypes: {}, unresolvedSpeakers: [], unterminatedBlocks: [] };

  // Pre-scan ::actors block to build alias map and actor list.
  // Format:
  //   ::actors
  //   @actor npc_john_akerson          ← exact entity ID
  //   @alias npc_john_akerson JOHN     ← JOHN: dialogue lines map to npc_john_akerson
  const aliases  = {};  // ALIAS_LABEL (uppercase) → entity id
  const displays = {};  // entity id → on-air billing (the first alias declared for it)
  const actorIds = [];  // entity ids in declaration order
  let _inActors = false;
  for (const ln of lines) {
    const t = ln.trim();
    if (t === '::actors')                       { _inActors = true;  continue; }
    if (t.startsWith('::') && t !== '::actors') { _inActors = false; continue; }
    if (!_inActors) continue;
    const mActor = t.match(/^@actor\s+(\S+)/);
    if (mActor) { actorIds.push(mActor[1]); continue; }
    const mAlias = t.match(/^@?alias\s+(\S+)\s+(.+)$/);
    if (mAlias) aliases[mAlias[2].trim().toUpperCase()] = mAlias[1];
    // ⚠ A BILLING IS NOT AN ALIAS, and deriving one from the other is wrong in a way
    // that is invisible until it airs. An alias is TYPING SHORTHAND — `@alias
    // npc_neil_mcmanistan NEIL` exists so the author can write `NEIL:` — so treating
    // every alias as a stage name puts "NEIL says" and "LAWYER says" on screen for
    // two men who have perfectly good names.
    //
    // A billing is the opposite: a deliberate refusal to use the name. A crew member
    // the programme credits only as PRODUCER could previously be billed that way ONLY
    // by naming the NPC "PRODUCER", which then follows him around the world — into
    // room descriptions, examine, SIFT and his own front door. So it is its own
    // directive, and it also registers the label, because a man billed as PRODUCER is
    // always going to be written as `PRODUCER:` in the script:
    //
    //   @billing npc_phil_mccracken PRODUCER
    const mBilling = t.match(/^@?billing\s+(\S+)\s+(.+)$/);
    if (mBilling) {
      const name = mBilling[2].trim();
      displays[mBilling[1]] = name;
      aliases[name.toUpperCase()] = mBilling[1];
    }
  }

  // Pre-scan @type and the ::cast block. A film's speaker lines compile differently
  // from every other type (see below), and @type may legally sit anywhere in the
  // header, so both have to be known before the body pass starts.
  //   ::cast
  //   DIRK | Dirk Vantablack | the kid with the voice
  //   ::endcast
  // Cast entries are DISPLAY NAMES, not npc_ ids: a film's characters are photographed
  // people in a recording, not studio staff. Nothing here ever reaches npcIds, so
  // importing a film never spawns an NPC and never presence-gates.
  const cast = [];              // [{ label, name, role }] in declaration order
  const castByLabel = {};       // LABEL (uppercase) → display name
  let _preType = 'live';
  {
    let inCast = false;
    for (const ln of lines) {
      const t = ln.trim();
      if (t === '::cast')                     { inCast = true;  continue; }
      if (t.startsWith('::') && t !== '::cast') { inCast = false; continue; }
      if (inCast) {
        if (!t || t.startsWith('#')) continue;
        const [label, name, role] = t.split('|').map(p => p.trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
        if (!label) continue;
        const display = name || label.replace(/\b\w/g, c => c.toUpperCase());
        cast.push({ label: label.toUpperCase(), name: display, role: role || '' });
        castByLabel[label.toUpperCase()] = display;
        continue;
      }
      const mType = t.match(/^@type\s+(\S+)/i);
      if (mType) _preType = mType[1].toLowerCase();
    }
  }
  const isFilm = _preType === 'film';

  // Implicit actor aliases: a SPEAKER label with no explicit @alias still resolves
  // to a declared @actor when it matches that actor's derived name — the humanized
  // id ("npc_lucky_chen" → "LUCKY CHEN"), its first word ("LUCKY"), or its last word
  // ("CHEN"). This spares authors from writing an @alias line for the obvious cases
  // and, crucially, stops the importer from minting a duplicate npc_<label> placeholder
  // when the actor is already declared. Only applied when exactly one declared actor
  // owns the label: an ambiguous first name (two actors both "LUCKY …") falls through
  // to the normal fallback rather than silently picking one.
  const implicitAliasIndex = {};  // KEY (uppercase) → Set(actorId)
  for (const id of actorIds) {
    const words = id.replace(/^npc_/, '').split(/[_\s]+/).filter(Boolean);
    if (!words.length) continue;
    const keys = new Set([
      words.join(' ').toUpperCase(),
      words[0].toUpperCase(),
      words[words.length - 1].toUpperCase(),
    ]);
    for (const k of keys) (implicitAliasIndex[k] ||= new Set()).add(id);
  }
  const implicitActor = (label) => {
    const set = implicitAliasIndex[label];
    return set && set.size === 1 ? [...set][0] : undefined;
  };

  const nodes = {};
  const assets = [];
  const weatherPools = {};    // pool_key → [line, …]  (only meaningful for @type weather AND @type sports — both use ::lines pools)
  const teams = [];           // team names from ::teams block  (only meaningful for @type sports)
  const players = [];         // player names from ::players block (only meaningful for @type sports)
  const guests = [];          // guest personas {name,title,theme} from ::guests block (only meaningful for @type talkshow)
  const contestants = [];     // plain contestant NAMES from ::contestants block (only meaningful for @type gameshow)
  const celebrants = [];      // {name,title,tag} from ::celebrants block (only meaningful for @type sermon)
  const messages = [];
  const rooms = [];           // zone IDs from ROOM directives (ordered, deduplicated)
  const cameraNumbers = [];   // unique CAM numbers in order of first appearance
  const npcIds = new Set(actorIds); // pre-populated from ::actors; grows with explicit NPC directives

  let nodeCount = 0;
  let startId = null;
  let prevId = null;
  let activeNpc = null;

  function makeNode(data) {
    const id = `bsm_${nodeCount}`;
    const col = nodeCount % 5;
    const row = Math.floor(nodeCount / 5);
    nodeCount++;
    nodes[id] = { ...data, _vine: { x: 80 + col * 220, y: 80 + row * 160 } };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    if (data.type === 'npc_anchor' && data.npc_id) npcIds.add(data.npc_id);
    _debug.nodeTypes[data.type] = (_debug.nodeTypes[data.type] || 0) + 1;
    return id;
  }

  // Entry point
  makeNode({ type: 'start' });

  // Word(s) followed immediately by colon on its own line: JOHN:  Lucky:  Captain Nguyen:
  // Case-insensitive; alias lookup normalises to uppercase. A second+ word must be
  // Title Case (like a surname) so plain sentences ending in ":" aren't mistaken
  // for a multi-word speaker label.
  const SPEAKER_RE = /^([A-Za-z][A-Za-z0-9_]*(?:\s[A-Z][A-Za-z0-9_]*)*):\s*$/;

  // Reserved speaker labels for an unseen off-screen announcer — NOT a real NPC.
  // Regardless of broadcast type, a NARRATOR:/ANNOUNCER: line becomes a narration
  // say node with no npc_anchor (so nothing is added to npcIds, no studio NPC is
  // spawned); the runner plays it on TV and over the studio speakers. An explicit
  // @alias mapping the label to an actor still wins, for back-compat.
  const ANNOUNCER_LABELS = new Set(['NARRATOR', 'ANNOUNCER']);

  const DIRECTIVE_PREFIXES = [
    '@', '::', 'EVENT ', 'TITLE ', 'TICKER', 'WAIT', 'NPC ', 'OVERLAY',
    'SHOT', 'SHOT_END', 'TICKER_END', 'OVERLAY_END', 'LOWER_THIRD_END', 'MUSIC_END', 'END', 'CAM ', 'ROOM ', 'LOWER_THIRD',
    'MUSIC', 'ENTER ', 'ACTION', 'END_ACTION', '♪', 'TECH_DIFFICULTIES ', 'CREDITS',
    'ACT ', 'SLUG ', 'INTERMISSION', 'LETTERBOX ', 'FADE ',
  ];

  const BARE_DURATION_RE = /^(\d+(?:\.\d+)?)s?$/;  // "8s", "2s", "1.5s", "8"

  function isDirectiveLine(ln) {
    if (!ln) return false;
    return DIRECTIVE_PREFIXES.some(p => ln.startsWith(p)) || SPEAKER_RE.test(ln) || BARE_DURATION_RE.test(ln);
  }

  // `prose: true` makes a missing terminator recoverable. A presentation block
  // (SHOT, OVERLAY, MUSIC…) holds authored prose, so the first DIRECTIVE line is
  // proof the author forgot the terminator — bail there rather than running to EOF.
  // Without this, one missing SHOT_END silently swallowed the whole rest of the
  // script into a single narration node, and the raw directives ("CAM 1", "4s",
  // "OVERLAY_END") aired at the player as one unbroken paragraph. Data blocks
  // (::endasset, ::endlines…) pass prose:false — their contents are box-drawing art
  // and pool lines that may legitimately look like directives.
  function collectBlock(terminator, prose = false) {
    const buf = [];
    let closed = false;
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln === terminator) { i++; closed = true; break; }
      if (prose && isDirectiveLine(ln)) break;   // leave i on the directive; the main loop handles it
      buf.push(lines[i]);
      i++;
    }
    if (!closed) _debug.unterminatedBlocks.push(terminator);
    return buf.join('\n').trim();
  }

  // Strip only a MATCHED wrapping quote pair around the WHOLE value — never quotes that
  // are part of the value. Quoting exists so a name with spaces survives; a nickname like
  // "Big" Halvorsen or "Wheels" McGraw is the value, and the naive anchored strip this
  // replaced ate its opening quote and shipped `Big" Halvorsen` to air. Same rule the
  // ::guests parser already used; this is it applied everywhere a name is read.
  const unquote = (s) => s.replace(/^(["'])([\s\S]*)\1$/, '$2');

  while (i < lines.length) {
    const ln = lines[i].trim();

    if (!ln) { i++; continue; }

    // ── Line comment ─────────────────────────────────────────────────────────
    if (ln.startsWith('#')) { i++; continue; }

    // ── EOF marker ───────────────────────────────────────────────────────────
    if (ln === 'END') break;

    // ── Header directives ────────────────────────────────────────────────────
    if (ln.startsWith('@')) {
      const m = ln.match(/^@(\w+)\s*(.*)/);
      if (m) {
        const key = m[1], val = m[2].trim();
        if (key === 'broadcast') meta.name = unquote(val);
        else if (key === 'channel') meta.channel = val;
        else if (key === 'category') meta.category = val;
        else if (key === 'host') meta.host = val;
        else if (key === 'length') meta.length = parseFloat(val);
        else if (key === 'type') meta.type = val.toLowerCase();
        else if (key === 'sport') meta.sport = val.toLowerCase();               // sports: which sim to run (baseball)
        else if (key === 'announcer') meta.announcer = unquote(val); // sports/news: voiceover/announcer — a name string, NOT an npc_ id
        // news: anchor(s) and field reporter(s) — plain NAME strings, repeatable, NOT npc_ ids.
        // First @anchor is the lead anchor ({anchor}); a second is the co-anchor ({anchor2}).
        else if (key === 'anchor')   { const nm = unquote(val); if (nm) meta.anchors.push(nm); }
        else if (key === 'reporter') { const nm = unquote(val); if (nm) meta.reporters.push(nm); }
        // news: the weather desk. A name string like the anchors — the bulletin's weather
        // segment reads the SAME live forecast DOOMCAST does, in this person's voice.
        else if (key === 'meteorologist') meta.meteorologist = unquote(val);
        // sports: feature only the game(s) covering these IN-GAME hours (0–23) each day —
        // one full game, grid-snapped, at a fixed time of day. Omit ⇒ continuous (back-to-back
        // games all day). "@airtime 19" → the evening (18:00–21:00) game airs daily.
        else if (key === 'airtime') meta.airSlots = [...new Set(val.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n < 24).map(h => Math.floor(h / 3) % 8))];
        else if (key === 'titlecard') meta.titlecard = val;   // weather/news: graphic id shown before the report
        else if (key === 'theme') meta.theme = unquote(val);  // news/talkshow: intro theme sting — an audio_songs.name OR an audio_samples.name (quote names with spaces)
        // talkshow: the REAL studio cast — npc_ ids, acted live on stage (unlike news/sports names).
        // @host = desk host, @sidekick = announcer/bandleader who does the intro, @guest = the
        // reusable guest NPC renamed each episode. All three are spawned/placed by the importer.
        else if (key === 'sidekick') meta.sidekick = val;
        else if (key === 'guest')    meta.guestNpc = val;
        // morning: the second host on the couch — a real npc_ id, like @host. The two trade
        // every beat, so the pools are authored as "host line >> cohost line" pairs.
        else if (key === 'cohost')   meta.cohost = val;
        // ON LOCATION. A programme shot somewhere that is not its channel's studio
        // names the zone here, and the runner stages the whole thing there: the cast
        // walk to it, the cameras that count are the ones standing in it, and the
        // lines the acting layer puts in a room go into that room. Omit for the
        // overwhelming default, which is that a show happens where the channel lives.
        else if (key === 'location') meta.location = val;
        // film: the pre-roll cards. @presents is the production company on the
        // distributor card, @rating the certification card, @director the "a film by"
        // credit. All three are plain strings — a film has no studio cast.
        // film: which weekday(s) the picture screens. Names or 1-7 (Mon=1), comma or
        // space separated, repeatable. Omit and it screens every day — which for a
        // feature is usually wrong: nine in-game hours every night is most of a channel.
        else if (key === 'airday') {
          const NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
          for (const tok of val.split(/[,\s]+/).filter(Boolean)) {
            const n = Number(tok);
            const d = Number.isFinite(n) ? n : NAMES.indexOf(tok.slice(0, 3).toLowerCase()) + 1;
            if (d >= 1 && d <= 7 && !meta.airDays.includes(d)) meta.airDays.push(d);
          }
        }
        // sermon: the unseen voice that opens and closes the service — a name, not an NPC.
        else if (key === 'verger')   meta.verger = unquote(val);
        else if (key === 'presents') meta.presents = unquote(val);
        else if (key === 'rating')   meta.rating   = unquote(val);
        else if (key === 'director') meta.director = unquote(val);
        // gameshow: what the show asks ABOUT — the subject id registered in
        // plugins/broadcast/gameshow-subjects.js ('retail', 'basin'). Omit ⇒ retail,
        // which is what every game show was before subjects existed.
        else if (key === 'subject')  meta.subject = val.replace(/^[\"']|[\"']$/g, '').toLowerCase();
        // gameshow: how many rounds an episode plays (1–4). Omit ⇒ all four.
        else if (key === 'rounds')   { const r = parseInt(val, 10); if (Number.isFinite(r)) meta.rounds = r; }
        // @actor / @alias are pre-scanned from ::actors block; skip here
      }
      i++; continue;
    }

    // ── Structural markers ───────────────────────────────────────────────────
    if (ln.startsWith('::asset ')) {
      const assetId = ln.slice(8).trim();
      i++;
      const content = collectBlock('::endasset');
      const assetType = /^\s*<svg[\s>]/i.test(content) ? 'svg' : 'ascii';
      assets.push({ id: assetId, name: assetId, type: assetType, content });
      continue;
    }

    // ── Weather line pool (::lines <key> … ::endlines) ──────────────────────
    // Each non-empty line inside is one interchangeable alternative for that
    // situation; the broadcast runner picks one at random per airing. Re-declared
    // keys merge. See docs/bsm-format.md#weather-broadcasts-type-weather.
    if (ln.startsWith('::lines ')) {
      const key = ln.slice(8).trim();
      i++;
      const content = collectBlock('::endlines');
      const opts = content.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      if (key && opts.length) (weatherPools[key] || (weatherPools[key] = [])).push(...opts);
      continue;
    }

    // ── Sports team pool (::teams … ::endteams) — one team name per line ──────
    // The sports runner picks two (home + away) at random per airing. Surrounding
    // quotes are stripped so names with spaces can be quoted if desired.
    if (ln === '::teams') {
      i++;
      const content = collectBlock('::endteams');
      for (const s of content.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('#'))) {
        teams.push(unquote(s));
      }
      continue;
    }

    // ── Sports player-name pool (::players … ::endplayers) ───────────────────
    // The runner deals nine names to each team's lineup per airing.
    if (ln === '::players') {
      i++;
      const content = collectBlock('::endplayers');
      for (const s of content.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('#'))) {
        players.push(unquote(s));
      }
      continue;
    }

    // ── Talk-show guest-persona pool (::guests … ::endguests) ────────────────
    // One persona per line: "Name | Title | theme_song | tag". Title/theme/tag optional.
    // The talkshow runner picks one persona per episode, renames the reusable guest NPC to
    // it, and fills {guest}/{title} tokens from it. The optional `tag` names a persona-specific
    // answer pool (::lines interview.a.<tag>) so that guest gets signature lines in the
    // interview, mixed with the generic answers.
    if (ln === '::guests') {
      i++;
      const content = collectBlock('::endguests');
      for (const s of content.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('#'))) {
        // Strip only a MATCHED wrapping quote pair around the whole field — not quotes
        // that are part of the value (e.g. a nickname like "Sparky" Reyes).
        const [name, title, theme, tag] = s.split('|').map(p => p.trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
        if (name) guests.push({ name, title: title || '', theme: theme || '', tag: tag || '' });
      }
      continue;
    }

    // ── Sermon celebrant roster (::celebrants … ::endcelebrants) ─────────────
    // One celebrant per line: "Name | Title | tag". Title and tag optional. These are
    // display NAMES, never npc_ ids — a sermon is dynamic but NOT acted, so nothing here
    // spawns a studio NPC. The optional `tag` names that celebrant's signature pools
    // (`exegesis.<tag>`, `interjection.<tag>`), which is what stops five preachers from
    // all sounding like one preacher.
    if (ln === '::celebrants') {
      i++;
      const content = collectBlock('::endcelebrants');
      for (const t of content.split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#'))) {
        const [name, title, tag] = t.split('|').map(x => x.trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
        if (name) celebrants.push({ name, title: title || '', tag: tag || '' });
      }
      continue;
    }

    // ── Game-show contestant names (::contestants … ::endcontestants) ────────
    // One name per line, PLAIN STRINGS — not npc_ ids. The strangers on the studio floor
    // are spoken attribution only: they never get bodies, never commute, never spawn. Their
    // guesses are generated deterministically from the episode seed, so they lose
    // convincingly for free. A player standing in the studio plays alongside them.
    if (ln === '::contestants') {
      i++;
      const content = collectBlock('::endcontestants');
      for (const s of content.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('#'))) {
        contestants.push(s.replace(/^(["'])([\s\S]*)\1$/, '$2'));
      }
      continue;
    }

    // ── Film cast list (::cast … ::endcast) ──────────────────────────────────
    // Pre-scanned above into `cast`/`castByLabel`; consumed here so the body pass
    // never mistakes a "LABEL | Name | role" row for content.
    if (ln === '::cast') { i++; collectBlock('::endcast'); continue; }

    if (ln.startsWith('::')) { i++; continue; }  // ::actors, ::endactors, ::scene, ::endasset, etc.

    // ── EVENT (placeholder node for future VINE node types) ──────────────────
    if (ln.startsWith('EVENT ')) {
      makeNode({ type: 'event', event_type: ln.slice(6).trim() });
      i++; continue;
    }

    // ── TECH_DIFFICULTIES — channel offline graphic for N seconds ───────────
    if (ln.startsWith('TECH_DIFFICULTIES ')) {
      makeNode({ type: 'tech_difficulties', duration: parseFloat(ln.slice(18)) || 10 });
      i++; continue;
    }

    // ── TITLE (Phase 3 title_card node) ─────────────────────────────────────
    if (ln.startsWith('TITLE ')) {
      makeNode({ type: 'title_card', graphic_id: ln.slice(6).trim() });
      i++; continue;
    }

    // ── TICKER block ─────────────────────────────────────────────────────────
    if (ln === 'TICKER') {
      i++;
      const text = collectBlock('TICKER_END', true);
      makeNode({ type: 'ticker', text });
      messages.push(text);
      continue;
    }

    // ── WAIT ─────────────────────────────────────────────────────────────────
    if (ln === 'WAIT' || ln.startsWith('WAIT ')) {
      const sec = ln === 'WAIT' ? 5 : (parseFloat(ln.slice(5)) || 5);
      makeNode({ type: 'wait', duration: sec });
      i++; continue;
    }

    // ── ROOM — record zone dependency, no node ───────────────────────────────
    if (ln.startsWith('ROOM ')) {
      const zoneId = ln.slice(5).trim();
      if (zoneId && !rooms.includes(zoneId)) rooms.push(zoneId);
      i++; continue;
    }

    // ── CAM cut ──────────────────────────────────────────────────────────────
    if (/^CAM \d/.test(ln)) {
      const parts = ln.split(/\s+/);
      const camNum = parseInt(parts[1], 10);
      if (!isNaN(camNum) && !cameraNumbers.includes(camNum)) cameraNumbers.push(camNum);
      const label = [parts[0], parts[1], parts.slice(2).join(' ')].filter(Boolean).join(' — ');
      makeNode({ type: 'camera_cut', zone_id: '', label });
      i++; continue;
    }

    // ── OVERLAY text_card (bare OVERLAY, no graphic id) ─────────────────────
    if (ln === 'OVERLAY') {
      i++;
      const text = collectBlock('OVERLAY_END', true);
      makeNode({ type: 'overlay', overlayType: 'text_card', text });
      continue;
    }

    // ── OVERLAY with graphic id ──────────────────────────────────────────────
    if (ln.startsWith('OVERLAY ')) {
      const graphicId = ln.slice(8).trim();
      i++;
      const textLines = [];
      while (i < lines.length) {
        const ol = lines[i].trim();
        if (ol === 'OVERLAY_END') { i++; break; }
        if (isDirectiveLine(ol)) break;
        textLines.push(ol);
        i++;
      }
      makeNode({ type: 'overlay', graphic_id: graphicId, text: textLines.filter(Boolean).join('\n') });
      continue;
    }

    // ── LOWER_THIRD block → overlay node ────────────────────────────────────
    if (ln === 'LOWER_THIRD') {
      i++;
      const ltLines = [];
      while (i < lines.length) {
        const ol = lines[i].trim();
        if (ol === 'LOWER_THIRD_END') { i++; break; }
        if (isDirectiveLine(ol)) break;
        if (ol) ltLines.push(ol);
        i++;
      }
      const [ltText = '', ltSubtext = ''] = ltLines;
      makeNode({ type: 'overlay', overlayType: 'lower_third', text: ltText, subtext: ltSubtext, graphic_id: '' });
      continue;
    }

    // ── SHOT block → narration (no NPC prefix) ───────────────────────────────
    if (ln === 'SHOT') {
      i++;
      const text = collectBlock('SHOT_END', true);
      makeNode({ type: 'say', text, style: 'narration' });
      messages.push(text);
      continue;
    }

    // ── CREDITS block → scrolling end-credits ────────────────────────────────
    // Optional duration in seconds: CREDITS 30
    if (ln === 'CREDITS' || ln.startsWith('CREDITS ')) {
      const durStr = ln.slice(7).trim();
      const duration = durStr ? (parseFloat(durStr) || null) : null;
      i++;
      const text = collectBlock('END_CREDITS', true);
      const nodeData = { type: 'credits', text };
      if (duration !== null) nodeData.duration = duration;
      makeNode(nodeData);
      continue;
    }

    // ── Film structure: ACT / SLUG / INTERMISSION / LETTERBOX / FADE ─────────
    // Authored for @type film but harmless in any linear script — they all compile
    // to ordinary overlay nodes, differing only in overlayType, so the existing
    // walker, the late-tune seeker and the TV panel already know how to carry them.

    // ACT 2 — The Boom  →  a chapter card between the movement of the story.
    if (/^ACT\s+\S/.test(ln)) {
      const rest = ln.slice(3).trim();
      // The act number, then the subtitle. ":" is the house style (the em dash is
      // reserved for the Architect and the Ascendants — see story.md, Tone), but the
      // dash forms still split so older scripts keep their two-line card.
      const m = rest.match(/^(\S+?):?\s*(?:[—–:-]\s*(.+))?$/);
      makeNode({
        type: 'overlay', overlayType: 'act_card',
        text: `ACT ${m ? m[1] : rest}`, subtext: (m && m[2]) ? m[2].trim() : '',
        duration_s: 8,
      });
      i++; continue;
    }

    // SLUG SAN FERNANDO BASIN | 2079 — SUMMER  →  the scene slug, lower-third style.
    // Everything before the first "|" is the place, the rest is the time.
    if (ln.startsWith('SLUG ')) {
      const [where, ...when] = ln.slice(5).split('|').map(s => s.trim());
      makeNode({
        type: 'overlay', overlayType: 'lower_third',
        text: where, subtext: when.join(' — '), graphic_id: '', duration_s: 6,
      });
      i++; continue;
    }

    // INTERMISSION [seconds] — the reel change. Holds the house card; a viewer who
    // tunes in during one sees the intermission, exactly as they would have.
    if (ln === 'INTERMISSION' || ln.startsWith('INTERMISSION ')) {
      const sec = ln === 'INTERMISSION' ? 60 : (parseFloat(ln.slice(13)) || 60);
      makeNode({
        type: 'overlay', overlayType: 'intermission',
        text: 'INTERMISSION', subtext: '', duration_s: sec,
      });
      i++; continue;
    }

    // LETTERBOX on|off — a PERSISTENT layer (duration 0), not a timed card. The bars
    // stay until they're switched off, so a feature can frame itself wide and drop
    // back to broadcast-safe for a credit crawl.
    if (/^LETTERBOX\s+/i.test(ln)) {
      const on = !/off/i.test(ln.slice(9));
      makeNode({ type: 'overlay', overlayType: 'letterbox', on, text: '', duration_s: 0 });
      i++; continue;
    }

    // FADE out|in [seconds] — the optical transition between scenes.
    if (/^FADE\s+/i.test(ln)) {
      const parts = ln.slice(5).trim().split(/\s+/);
      const dir = /in/i.test(parts[0] || '') ? 'in' : 'out';
      const sec = parseFloat(parts[1]) || 3;
      makeNode({ type: 'overlay', overlayType: 'fade', fade: dir, text: '', duration_s: sec });
      i++; continue;
    }

    // ── Explicit NPC anchor ──────────────────────────────────────────────────
    if (ln.startsWith('NPC ')) {
      const npcId = ln.slice(4).trim();
      if (npcId !== activeNpc) {
        makeNode({ type: 'npc_anchor', npc_id: npcId, ...(displays[npcId] ? { display: displays[npcId] } : null) });
        activeNpc = npcId;
      }
      i++; continue;
    }

    // ── Speaker dialogue (implicit NPC anchor on voice change) ───────────────
    const speakerMatch = ln.match(SPEAKER_RE);
    if (speakerMatch) {
      const speaker = speakerMatch[1].toUpperCase();
      // A film is a RECORDING, not a live studio: its characters are display names
      // from ::cast, never npc_ ids. The line is pre-rendered with its own attribution
      // and emitted `verbatim` — the walker airs such a line exactly as written and
      // still leaks it to bystanders as [TV] speech, with no anchor and no NPC.
      // NARRATOR:/ANNOUNCER: stay reserved in a film too. A voice-over is the one voice
      // in a picture with nobody attached to it — "Narrator says, …" over the opening
      // titles is exactly wrong — so unless the file explicitly casts the label, it falls
      // through to the shared announcer path and airs as bare narration, like a SHOT block.
      if (isFilm && !(ANNOUNCER_LABELS.has(speaker) && !castByLabel[speaker])) {
        // Screenplay labels are conventionally ALL CAPS, so an undeclared walk-on has to
        // be lowercased before it is title-cased or "BARMAN:" airs as "BARMAN says".
        const who = castByLabel[speaker]
          || speakerMatch[1].toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        i++;
        let ftext = '';
        while (i < lines.length) {
          const tl = lines[i].trim();
          if (!tl) { i++; continue; }
          if (isDirectiveLine(tl)) break;
          ftext = tl; i++; break;
        }
        if (!ftext) continue;
        const rendered = `${who} says, "${ftext}"`;
        makeNode({ type: 'say', text: rendered, style: 'verbatim' });
        messages.push(rendered);
        continue;
      }
      const resolved = aliases[speaker] ?? implicitActor(speaker);
      // Unseen announcer — no NPC, no anchor. (An explicit @alias still wins.)
      const isAnnouncer = ANNOUNCER_LABELS.has(speaker) && !resolved;
      const fallbackId = `npc_${speaker.toLowerCase().replace(/\s+/g, '_')}`;
      if (!resolved && !isAnnouncer && !_debug.unresolvedSpeakers.some(u => u.label === speaker)) {
        _debug.unresolvedSpeakers.push({ label: speaker, fallback: fallbackId });
      }
      const npcId = resolved ?? fallbackId;
      i++;
      let text = '';
      while (i < lines.length) {
        const tl = lines[i].trim();
        if (!tl) { i++; continue; }
        if (isDirectiveLine(tl)) break;
        text = tl; i++; break;
      }
      if (!text) continue;
      if (isAnnouncer) {
        // Narration style: played by no one on stage — over the studio speakers
        // and on TV as a bare line, never attributed to an NPC.
        makeNode({ type: 'say', text, style: 'narration' });
        messages.push(text);
        continue;
      }
      if (npcId !== activeNpc) {
        makeNode({ type: 'npc_anchor', npc_id: npcId, ...(displays[npcId] ? { display: displays[npcId] } : null) });
        activeNpc = npcId;
      }
      makeNode({ type: 'say', text, style: 'raw' });
      messages.push(text);
      continue;
    }

    // ── Bare duration  "8s" / "2s" / "1.5s" ────────────────────────────────────
    const durMatch = ln.match(BARE_DURATION_RE);
    if (durMatch) {
      makeNode({ type: 'wait', duration: parseFloat(durMatch[1]) });
      i++; continue;
    }

    // ── Block terminators appearing outside their blocks — silently skip ────────
    if (ln.endsWith('_END') || ln === 'END_ACTION' || ln === 'END_CREDITS') { i++; continue; }

    // ── MUSIC block — theme name plays the matching audio_songs row if one
    // exists; body text is the display line (shown alongside the song, or
    // alone as a fallback if no song by that name is registered) ────────────
    if (ln === 'MUSIC' || ln.startsWith('MUSIC ')) {
      const song = ln === 'MUSIC' ? '' : ln.slice(6).trim();
      i++;
      const displayText = collectBlock('MUSIC_END', true);
      if (song || displayText) makeNode({ type: 'music', song, text: displayText });
      continue;
    }

    // ── ENTER stage direction → npc_anchor + npc_action "enters" ─────────────
    if (ln.startsWith('ENTER ')) {
      const raw = ln.slice(6).trim();
      const npc = raw.startsWith('npc_') ? raw : `npc_${raw}`;
      if (npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc, ...(displays[npc] ? { display: displays[npc] } : null) }); activeNpc = npc; }
      makeNode({ type: 'npc_action', message: 'enters the frame.' });
      i++; continue;
    }

    // ── ACTION stage direction → npc_anchor + npc_action ─────────────────────
    if (ln === 'ACTION') {
      i++;
      const content = collectBlock('END_ACTION', true);
      const [rawFirst, ...rest] = content.trim().split(/\s+/);
      const npc = rawFirst ? (rawFirst.startsWith('npc_') ? rawFirst : `npc_${rawFirst}`) : activeNpc;
      const act = rest.join(' ');
      if (npc && npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc, ...(displays[npc] ? { display: displays[npc] } : null) }); activeNpc = npc; }
      if (act) makeNode({ type: 'npc_action', message: act });
      continue;
    }
    if (ln.startsWith('ACTION ')) {
      const parts = ln.slice(7).trim().split(/\s+/);
      const rawNpc = parts[0] || '';
      const npc = rawNpc.startsWith('npc_') ? rawNpc : `npc_${rawNpc}`;
      const act = parts.slice(1).join(' ');
      if (npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc, ...(displays[npc] ? { display: displays[npc] } : null) }); activeNpc = npc; }
      if (act) makeNode({ type: 'npc_action', message: act });
      i++; continue;
    }

    // ── ♪ music-cue text lines ───────────────────────────────────────────────
    if (ln.startsWith('♪')) {
      // Skip bare cue-name markers like ♪ tonight_theme ♪ (single word = compiler ID, not display text)
      const inner = ln.replace(/^♪\s*|\s*♪$/g, '').trim();
      if (!/\s/.test(inner)) { i++; continue; }
      makeNode({ type: 'say', text: ln, style: 'ambient' });
      i++; continue;
    }

    if (activeNpc) {
      makeNode({ type: 'npc_action', message: ln });
    } else if (isFilm) {
      // Screenplay action line. A film has no active NPC to attribute a stage
      // direction to, and wrapping every "He crosses the lot" in SHOT/SHOT_END for a
      // two-and-a-half-hour feature would be all scaffolding and no script — so bare
      // prose in a film IS the narration, exactly as it reads on the page.
      makeNode({ type: 'say', text: ln, style: 'narration' });
      messages.push(ln);
    } else {
      _debug.unknownDirectives.push(ln);
    }
    i++;
  }

  // Guard: ensure start node links to first content node if chain was broken
  if (startId && nodes[startId] && nodes[startId].next == null) {
    const firstContent = Object.keys(nodes).find(k => k !== startId);
    if (firstContent) nodes[startId].next = firstContent;
  }

  // Weather broadcasts supply line pools, not a linear graph. Make sure the
  // weathercaster host is declared so the importer creates/places it even if the
  // file omitted an ::actors entry for it.
  if (meta.type === 'weather' && meta.host) npcIds.add(meta.host);
  const weatherScript = { pools: weatherPools, host: meta.host, title: meta.titlecard || '' };

  // Sports broadcasts (@type sports) supply a line library plus team/player pools; the
  // server assembles a fresh simulated game each airing. The announcer is a plain name
  // string spoken as narration — deliberately NOT added to npcIds, so importing a sports
  // broadcast never spawns a studio NPC. See docs/bsm-format.md#sports-broadcasts-type-sports.
  const sportsScript = { sport: meta.sport || 'baseball', announcer: meta.announcer, teams, players, pools: weatherPools, title: meta.titlecard || '', airSlots: (meta.airSlots && meta.airSlots.length) ? meta.airSlots : null };

  // News broadcasts (@type news) are the weather/sports siblings: a line library (::lines
  // pools) whose facts come from the live news generator each airing. Anchors, reporters,
  // and the announcer are plain NAME strings spoken as narration — deliberately NOT added
  // to npcIds, so importing a news broadcast never spawns a studio NPC.
  // See docs/bsm-format.md#news-broadcasts-type-news.
  const newsScript = { anchors: meta.anchors, reporters: meta.reporters, announcer: meta.announcer, meteorologist: meta.meteorologist || '', pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '' };

  // Talk-show broadcasts (@type talkshow) are the live-acted procedural sibling: a line
  // library (::lines pools) + guest personas (::guests), assembled into a fresh episode
  // each night. Unlike news/sports, the cast (host + sidekick) and the renamed guest are
  // REAL npc_ ids acted on stage — so they ARE added to npcIds and the importer spawns/places
  // them. See docs/bsm-format.md#talk-show-broadcasts-type-talkshow.
  const talkshowScript = {
    host: meta.host || '', sidekick: meta.sidekick || '', guestNpc: meta.guestNpc || '',
    guests, pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '',
    airSlots: (meta.airSlots && meta.airSlots.length) ? meta.airSlots : null,
  };
  if (meta.type === 'talkshow') {
    for (const id of [meta.host, meta.sidekick, meta.guestNpc]) if (id) npcIds.add(id);
  }

  // Morning shows (@type morning) are the talk show's daytime cousin: a line library acted
  // live by TWO resident hosts, whose facts come from the live world (forecast, news feed,
  // alerts, the clock) rather than a guest persona. Both hosts are real npc_ ids on the
  // studio couch, so they ARE added to npcIds and the importer places them.
  // See docs/bsm-format.md#morning-shows-type-morning.
  const morningScript = {
    host: meta.host || '', cohost: meta.cohost || '',
    pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '',
  };
  if (meta.type === 'morning') {
    for (const id of [meta.host, meta.cohost]) if (id) npcIds.add(id);
  }

  // Game shows (@type gameshow) are the talk show's audience-participation sibling: a line
  // library acted live by a host (+ optional sidekick reading the prize copy), whose QUESTIONS
  // come from the live item catalog rather than from the file. Only the cast are real npc_ ids;
  // the ::contestants are name strings with no bodies. Any player standing in the studio when a
  // round opens is a contestant too. See docs/bsm-format.md#game-shows-type-gameshow.
  const gameshowScript = {
    host: meta.host || '', sidekick: meta.sidekick || '',
    contestants, pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '',
    airSlots: (meta.airSlots && meta.airSlots.length) ? meta.airSlots : null,
    rounds: meta.rounds || null, subject: meta.subject || '',
  };
  if (meta.type === 'gameshow') {
    for (const id of [meta.host, meta.sidekick]) if (id) npcIds.add(id);
  }

  // Film pre-roll. @presents / @rating / @director are cards that belong in front of
  // the picture, but the chain was built front-to-back by the body pass, so they're
  // spliced in between `start` and the first authored node afterwards rather than
  // making the author hand-write three overlays every time.
  if (isFilm && startId && (meta.presents || meta.rating || meta.director)) {
    const cards = [];
    if (meta.presents) cards.push({ text: meta.presents.toUpperCase(), subtext: 'presents', duration_s: 5 });
    if (meta.rating)   cards.push({ text: meta.rating, subtext: 'BASIN BROADCAST STANDARDS BOARD', duration_s: 5 });
    if (meta.director) cards.push({ text: `A film by ${meta.director}`, subtext: '', duration_s: 5 });
    const firstContent = nodes[startId].next || null;
    let link = startId;
    cards.forEach((card, n) => {
      const id = `bsm_pre_${n}`;
      nodes[id] = { type: 'overlay', overlayType: 'act_card', ...card, _vine: { x: 80 + n * 220, y: -120 } };
      nodes[link].next = id;
      link = id;
    });
    nodes[link].next = firstContent;
  }

  // Films (@type film) are the odd one out: NOT a line library at all, but the plain
  // linear chain a `scripted` broadcast compiles to — a feature is authored shot by
  // shot, it does not re-roll. What the extra envelope carries is everything the
  // chain can't: the pre-roll card copy, the cast list, and the @airtime block the
  // importer pins the picture to so it screens at a fixed hour and a late viewer
  // joins the reel already running. Nothing here is an npc_ id — see ::cast.
  const filmScript = {
    presents: meta.presents || '', rating: meta.rating || '', director: meta.director || '',
    cast, title: meta.titlecard || '', theme: meta.theme || '',
    airSlots: (meta.airSlots && meta.airSlots.length) ? meta.airSlots : null,
    airDays: meta.airDays.length ? meta.airDays : null,
    runtime: meta.length || null,
  };

  // Sermons (@type sermon) are the news type's Sunday cousin: a line library whose FACTS
  // come from the same live news generator, but read as scripture rather than reported.
  // Like news and unlike a talk show it is dynamic but NOT acted — the celebrants and the
  // verger are display NAMES, deliberately never added to npcIds, so importing a service
  // never spawns a studio NPC and it never presence-gates. `airDays` is what makes it a
  // Sunday programme rather than a daily one.
  const sermonScript = {
    celebrants, verger: meta.verger || '',
    pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '',
    airSlots: (meta.airSlots && meta.airSlots.length) ? meta.airSlots : null,
    airDays: meta.airDays.length ? meta.airDays : null,
  };

  return { meta, broadcastGraph: { _start: startId, nodes }, filmScript, sermonScript, weatherScript, sportsScript, newsScript, talkshowScript, morningScript, gameshowScript, messages, assets, rooms, cameras: cameraNumbers, npcIds: [...npcIds], actorIds, _debug };
}
