// bsm-compiler.js — .bsm broadcast script → VINE graph + flat messages + assets
// Client-side only. Functions land in global scope.

function compileBsm(text) {
  const lines = text.split('\n');
  let i = 0;

  const meta = { name: '', channel: '', category: 'general', host: '', length: null, type: 'live', sport: '', announcer: '', airSlots: null, anchors: [], reporters: [], sidekick: '', guestNpc: '', cohost: '' };
  const _debug = { unknownDirectives: [], nodeTypes: {}, unresolvedSpeakers: [] };

  // Pre-scan ::actors block to build alias map and actor list.
  // Format:
  //   ::actors
  //   @actor npc_john_akerson          ← exact entity ID
  //   @alias npc_john_akerson JOHN     ← JOHN: dialogue lines map to npc_john_akerson
  const aliases  = {};  // ALIAS_LABEL (uppercase) → entity id
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
  }

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
  ];

  const BARE_DURATION_RE = /^(\d+(?:\.\d+)?)s?$/;  // "8s", "2s", "1.5s", "8"

  function isDirectiveLine(ln) {
    if (!ln) return false;
    return DIRECTIVE_PREFIXES.some(p => ln.startsWith(p)) || SPEAKER_RE.test(ln) || BARE_DURATION_RE.test(ln);
  }

  function collectBlock(terminator) {
    const buf = [];
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln === terminator) { i++; break; }
      buf.push(lines[i]);
      i++;
    }
    return buf.join('\n').trim();
  }

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
        if (key === 'broadcast') meta.name = val.replace(/^["']|["']$/g, '');
        else if (key === 'channel') meta.channel = val;
        else if (key === 'category') meta.category = val;
        else if (key === 'host') meta.host = val;
        else if (key === 'length') meta.length = parseFloat(val);
        else if (key === 'type') meta.type = val.toLowerCase();
        else if (key === 'sport') meta.sport = val.toLowerCase();               // sports: which sim to run (baseball)
        else if (key === 'announcer') meta.announcer = val.replace(/^["']|["']$/g, ''); // sports/news: voiceover/announcer — a name string, NOT an npc_ id
        // news: anchor(s) and field reporter(s) — plain NAME strings, repeatable, NOT npc_ ids.
        // First @anchor is the lead anchor ({anchor}); a second is the co-anchor ({anchor2}).
        else if (key === 'anchor')   { const nm = val.replace(/^["']|["']$/g, ''); if (nm) meta.anchors.push(nm); }
        else if (key === 'reporter') { const nm = val.replace(/^["']|["']$/g, ''); if (nm) meta.reporters.push(nm); }
        // sports: feature only the game(s) covering these IN-GAME hours (0–23) each day —
        // one full game, grid-snapped, at a fixed time of day. Omit ⇒ continuous (back-to-back
        // games all day). "@airtime 19" → the evening (18:00–21:00) game airs daily.
        else if (key === 'airtime') meta.airSlots = [...new Set(val.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n < 24).map(h => Math.floor(h / 3) % 8))];
        else if (key === 'titlecard') meta.titlecard = val;   // weather/news: graphic id shown before the report
        else if (key === 'theme') meta.theme = val.replace(/^["']|["']$/g, '');  // news/talkshow: intro theme sting — an audio_songs.name OR an audio_samples.name (quote names with spaces)
        // talkshow: the REAL studio cast — npc_ ids, acted live on stage (unlike news/sports names).
        // @host = desk host, @sidekick = announcer/bandleader who does the intro, @guest = the
        // reusable guest NPC renamed each episode. All three are spawned/placed by the importer.
        else if (key === 'sidekick') meta.sidekick = val;
        else if (key === 'guest')    meta.guestNpc = val;
        // morning: the second host on the couch — a real npc_ id, like @host. The two trade
        // every beat, so the pools are authored as "host line >> cohost line" pairs.
        else if (key === 'cohost')   meta.cohost = val;
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
        teams.push(s.replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    // ── Sports player-name pool (::players … ::endplayers) ───────────────────
    // The runner deals nine names to each team's lineup per airing.
    if (ln === '::players') {
      i++;
      const content = collectBlock('::endplayers');
      for (const s of content.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('#'))) {
        players.push(s.replace(/^["']|["']$/g, ''));
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
      const text = collectBlock('TICKER_END');
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
      const text = collectBlock('OVERLAY_END');
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
      const text = collectBlock('SHOT_END');
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
      const text = collectBlock('END_CREDITS');
      const nodeData = { type: 'credits', text };
      if (duration !== null) nodeData.duration = duration;
      makeNode(nodeData);
      continue;
    }

    // ── Explicit NPC anchor ──────────────────────────────────────────────────
    if (ln.startsWith('NPC ')) {
      const npcId = ln.slice(4).trim();
      if (npcId !== activeNpc) {
        makeNode({ type: 'npc_anchor', npc_id: npcId });
        activeNpc = npcId;
      }
      i++; continue;
    }

    // ── Speaker dialogue (implicit NPC anchor on voice change) ───────────────
    const speakerMatch = ln.match(SPEAKER_RE);
    if (speakerMatch) {
      const speaker = speakerMatch[1].toUpperCase();
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
        makeNode({ type: 'npc_anchor', npc_id: npcId });
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
      const displayText = collectBlock('MUSIC_END');
      if (song || displayText) makeNode({ type: 'music', song, text: displayText });
      continue;
    }

    // ── ENTER stage direction → npc_anchor + npc_action "enters" ─────────────
    if (ln.startsWith('ENTER ')) {
      const raw = ln.slice(6).trim();
      const npc = raw.startsWith('npc_') ? raw : `npc_${raw}`;
      if (npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc }); activeNpc = npc; }
      makeNode({ type: 'npc_action', message: 'enters the frame.' });
      i++; continue;
    }

    // ── ACTION stage direction → npc_anchor + npc_action ─────────────────────
    if (ln === 'ACTION') {
      i++;
      const content = collectBlock('END_ACTION');
      const [rawFirst, ...rest] = content.trim().split(/\s+/);
      const npc = rawFirst ? (rawFirst.startsWith('npc_') ? rawFirst : `npc_${rawFirst}`) : activeNpc;
      const act = rest.join(' ');
      if (npc && npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc }); activeNpc = npc; }
      if (act) makeNode({ type: 'npc_action', message: act });
      continue;
    }
    if (ln.startsWith('ACTION ')) {
      const parts = ln.slice(7).trim().split(/\s+/);
      const rawNpc = parts[0] || '';
      const npc = rawNpc.startsWith('npc_') ? rawNpc : `npc_${rawNpc}`;
      const act = parts.slice(1).join(' ');
      if (npc !== activeNpc) { makeNode({ type: 'npc_anchor', npc_id: npc }); activeNpc = npc; }
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
  const newsScript = { anchors: meta.anchors, reporters: meta.reporters, announcer: meta.announcer, pools: weatherPools, title: meta.titlecard || '', theme: meta.theme || '' };

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

  return { meta, broadcastGraph: { _start: startId, nodes }, weatherScript, sportsScript, newsScript, talkshowScript, morningScript, messages, assets, rooms, cameras: cameraNumbers, npcIds: [...npcIds], actorIds, _debug };
}
