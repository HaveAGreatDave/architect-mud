// bsm-compiler.js — .bsm broadcast script → VINE graph + flat messages + assets
// Client-side only. Functions land in global scope.

function compileBsm(text) {
  const lines = text.split('\n');
  let i = 0;

  const meta = { name: '', channel: '', category: 'general', host: '', length: null, type: 'live' };
  const _debug = { unknownDirectives: [], nodeTypes: {} };

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
    const mAlias = t.match(/^@?alias\s+(\S+)\s+(\S+)/);
    if (mAlias) aliases[mAlias[2].toUpperCase()] = mAlias[1];
  }

  const nodes = {};
  const assets = [];
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

  // All-caps word followed immediately by colon on its own line: JOHN:  LUCKY:  ANNOUNCER:
  // Speaker labels resolve via the ::actors block.  Without an alias the compiler
  // generates npc_label_??? which appears unresolved in the dependency checker.
  const SPEAKER_RE = /^([A-Z][A-Z0-9_]*):\s*$/;

  const DIRECTIVE_PREFIXES = [
    '@', '::', 'EVENT ', 'TITLE ', 'TICKER', 'WAIT ', 'NPC ', 'OVERLAY ',
    'SHOT', 'SHOT_END', 'TICKER_END', 'OVERLAY_END', 'LOWER_THIRD_END', 'END', 'CAM ', 'ROOM ', 'LOWER_THIRD',
  ];

  function isDirectiveLine(ln) {
    if (!ln) return false;
    return DIRECTIVE_PREFIXES.some(p => ln.startsWith(p)) || SPEAKER_RE.test(ln);
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
        // @actor / @alias are pre-scanned from ::actors block; skip here
      }
      i++; continue;
    }

    // ── Structural markers ───────────────────────────────────────────────────
    if (ln === '::actors') { i++; continue; }  // block contents handled by pre-scan
    if (ln.startsWith('::scene ')) { i++; continue; }

    if (ln.startsWith('::asset ')) {
      const assetId = ln.slice(8).trim();
      i++;
      const content = collectBlock('::endasset');
      assets.push({ id: assetId, name: assetId, type: 'ascii', content });
      continue;
    }

    // ── EVENT (placeholder node for future VINE node types) ──────────────────
    if (ln.startsWith('EVENT ')) {
      makeNode({ type: 'event', event_type: ln.slice(6).trim() });
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
    if (ln.startsWith('WAIT ')) {
      makeNode({ type: 'wait', duration: parseFloat(ln.slice(5)) });
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

    // ── OVERLAY (Phase 3, with optional inline text block) ───────────────────
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

    // ── SHOT block → say node ────────────────────────────────────────────────
    if (ln === 'SHOT') {
      i++;
      const text = collectBlock('SHOT_END');
      makeNode({ type: 'say', text, style: 'raw' });
      messages.push(text);
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
      const speaker = speakerMatch[1];
      const npcId = aliases[speaker] ?? `npc_${speaker.toLowerCase()}`;
      i++;
      let text = '';
      while (i < lines.length) {
        const tl = lines[i].trim();
        if (!tl) { i++; continue; }
        if (isDirectiveLine(tl)) break;
        text = tl; i++; break;
      }
      if (!text) continue;
      if (npcId !== activeNpc) {
        makeNode({ type: 'npc_anchor', npc_id: npcId });
        activeNpc = npcId;
      }
      makeNode({ type: 'say', text, style: 'raw' });
      messages.push(text);
      continue;
    }

    _debug.unknownDirectives.push(ln);
    i++;
  }

  return { meta, broadcastGraph: { _start: startId, nodes }, messages, assets, rooms, cameras: cameraNumbers, npcIds: [...npcIds], actorIds, _debug };
}
