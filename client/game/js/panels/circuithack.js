// CIRCUIT BREACH — a node-graph hacking minigame rendered as a glowing cyberpunk
// PCB. You start at the ENTRY via and hop node→node along conductive traces to
// reach the CORE within a limited move budget. FIREWALL nodes (ICE) are hidden
// until your skill-scaled sensor reveals them; stepping on one trips an alarm.
// GATE vias are locked until you've collected their KEY; BOOST vias refund moves.
//
// A cosmetic breach overlay launched from the ATM JACK button (see panels/atm.js).
// The win/lose result is reported via opts.onResult; the ATM panel uses that to
// fire the server-side `jack` command, which is authoritative for the outcome
// (the real hacking skillCheck decides the payout — the minigame is flavour).
//
// Generation is verified solvable before display: a firewall-free, gate-respecting
// route to the core within the move budget always exists (state-space BFS over
// (node, keysHeld)). Difficulty scales grid size + ICE density; skill scales
// sensor range, alarms tolerated, and spare moves.

const ri = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Layout constants (SVG user units).
const STEP_X = 120, STEP_Y = 96, MARGIN = 74;

let _overlay = null;
let _keyHandler = null;
let _state = null;
let _opts = null;

// ── Audio ─────────────────────────────────────────────────────────────────
// Tiny inline SFX through the shared engine's SFX bus. All guarded — silent if
// the engine hasn't initialised.
function sfx(def) { try { window.AudioEngine?.playSfx(def); } catch { /* no audio */ } }
const SFX_MOVE  = { priority: 5, config: { duration: 0.05, layers: [ { waveform: 'square', freq: 620, adsr: { a: 0.002, d: 0.04, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 640, q: 4 }, gain: 0.16 } ] } };
const SFX_BOOST = { priority: 5, config: { duration: 0.16, layers: [ { waveform: 'square', freq: 740, pitchBend: { to: 1180, time: 0.12 }, adsr: { a: 0.003, d: 0.12, s: 0.1, r: 0.05 }, filter: { type: 'bandpass', freq: 1000, q: 3 }, gain: 0.16 } ] } };
const SFX_ALARM = { priority: 6, config: { duration: 0.4, layers: [
  { waveform: 'sawtooth', freq: 300, pitchBend: { to: 90, time: 0.35 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.005, d: 0.2, s: 0.3, r: 0.3 }, gain: 0.22 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 220, q: 2 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.06 }, gain: 0.5 } ] } };
const SFX_WIN   = { priority: 6, config: { duration: 0.5, layers: [
  { waveform: 'square', freq: 523, adsr: { a: 0.005, d: 0.4, s: 0.4, r: 0.3 }, gain: 0.12 },
  { waveform: 'square', freq: 784, delay: 0.09, adsr: { a: 0.005, d: 0.4, s: 0.4, r: 0.3 }, gain: 0.12 },
  { waveform: 'square', freq: 1047, delay: 0.18, adsr: { a: 0.005, d: 0.5, s: 0.3, r: 0.4 }, gain: 0.12 } ] } };
const SFX_LOSE  = { priority: 6, config: { duration: 0.7, layers: [
  { waveform: 'sawtooth', freq: 160, pitchBend: { to: 40, time: 0.6 }, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.01, d: 0.3, s: 0.4, r: 0.4 }, gain: 0.24 },
  { waveform: 'square', freq: 80, pitchBend: { to: 30, time: 0.6 }, adsr: { a: 0.01, d: 0.3, s: 0.4, r: 0.4 }, gain: 0.16 } ] } };

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('circuit-hack-styles')) return;
  const s = document.createElement('style');
  s.id = 'circuit-hack-styles';
  s.textContent = `
    #circuit-hack-overlay { position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,4,6,0.78); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #circuit-hack-overlay .ch-panel { position:relative; width:min(760px,95vw); background:linear-gradient(160deg,#0a1416,#050a0b 70%,#02090a);
      border:2px solid #1d4a48; border-radius:8px; box-shadow:0 0 0 1px #000, 0 0 40px rgba(55,245,219,0.25), inset 0 0 60px rgba(0,0,0,0.7);
      padding:12px 14px 14px; animation:ch-boot .3s ease-out; }
    @keyframes ch-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #circuit-hack-overlay .ch-close { position:absolute; top:9px; right:11px; z-index:3; width:26px; height:26px;
      background:#0c1416; color:#8fb0bb; border:1px solid #2b4a48; border-radius:2px; cursor:pointer; font-size:13px; }
    #circuit-hack-overlay .ch-close:hover { color:#ff4a5b; border-color:#ff4a5b; }
    #circuit-hack-overlay .ch-titlebar { display:flex; justify-content:space-between; align-items:center;
      font-size:12px; letter-spacing:3px; color:#37f5db; font-weight:bold; padding:2px 2px 8px; border-bottom:1px solid #16302f; }
    #circuit-hack-overlay .ch-titlebar .ch-target { color:#6f8792; font-weight:normal; letter-spacing:1px; }
    #circuit-hack-overlay .ch-hud { display:flex; gap:16px; padding:8px 2px; font-size:12px; color:#6f8792; letter-spacing:1px; flex-wrap:wrap; }
    #circuit-hack-overlay .ch-hud b { font-weight:bold; }
    #circuit-hack-overlay .ch-hud .hv-moves { color:#37f5db; }
    #circuit-hack-overlay .ch-hud .hv-alarm { color:#ffb23e; }
    #circuit-hack-overlay .ch-hud .hv-sensor { color:#8fb0bb; }
    #circuit-hack-overlay .ch-board { background:#040c0d; border:1px solid #16302f; border-radius:4px; overflow:hidden; }
    #circuit-hack-overlay .ch-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #circuit-hack-overlay .ch-status .ch-win { color:#46e05a; }
    #circuit-hack-overlay .ch-status .ch-lose { color:#ff4a5b; }
    #circuit-hack-overlay .ch-status .ch-warn { color:#ffb23e; }
    #circuit-hack-overlay .ch-actions { display:flex; gap:8px; margin-top:8px; }
    #circuit-hack-overlay .ch-btn { flex:1; padding:9px 6px; background:#0c1416; color:#8fb0bb; border:1px solid #2b4a48;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; }
    #circuit-hack-overlay .ch-btn:hover { transform:translateY(1px); box-shadow:inset 0 -1px 0 rgba(0,0,0,0.5); color:#37f5db; border-color:#37f5db; }
    #circuit-hack-overlay .ch-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
    /* SVG element classes */
    #circuit-hack-overlay .n-reach { cursor:pointer; }
    #circuit-hack-overlay .n-reach:hover .n-hit { stroke:#8ffbec; }
    @keyframes ch-flow { to { stroke-dashoffset:-20; } }
    #circuit-hack-overlay .trace-live { animation:ch-flow 1s linear infinite; }
    @keyframes ch-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
    #circuit-hack-overlay .ch-reachring { animation:ch-pulse 1.1s infinite; }
    @keyframes ch-corepulse { 0%,100%{r:20px;opacity:.5} 50%{r:26px;opacity:.15} }
    #circuit-hack-overlay .ch-coreglow { animation:ch-corepulse 2s infinite; }
    @keyframes ch-meflick { 0%,100%{opacity:1} 90%{opacity:1} 94%{opacity:.5} }
    #circuit-hack-overlay .ch-me { animation:ch-meflick 2.5s infinite; }
  `;
  document.head.appendChild(s);
}

// ── Generation ────────────────────────────────────────────────────────────────
function neighborsOf(state, id) { return state.adj.get(id) || new Set(); }

// Shortest firewall-free, gate-respecting route length ENTRY→CORE, or Infinity.
// State = (node, keysMask). Keys are bit positions per key node.
function minSafeMoves(state) {
  const start = 0 | keyBitAt(state, state.entry);
  const seen = new Set([state.entry + ':' + start]);
  let frontier = [{ n: state.entry, mask: start }];
  let dist = 0;
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      if (cur.n === state.core) return dist;
      for (const nb of neighborsOf(state, cur.n)) {
        const node = state.nodes[nb];
        if (node.type === 'firewall') continue;                 // route must avoid ICE
        if (node.type === 'gate' && !(cur.mask & node.gateBit)) continue; // need key first
        const mask = cur.mask | keyBitAt(state, nb);
        const k = nb + ':' + mask;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ n: nb, mask });
      }
    }
    frontier = next;
    dist++;
    if (dist > 200) break;
  }
  return Infinity;
}
function keyBitAt(state, id) { const n = state.nodes[id]; return n && n.type === 'key' ? n.keyBit : 0; }

// Build one candidate graph: jittered grid of vias joined by a random spanning
// tree plus extra loop traces (so junctions offer real routing choices).
function buildGraph(cols, rows) {
  const nodes = [];
  const idAt = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const jx = (Math.random() - 0.5) * STEP_X * 0.32;
    const jy = (Math.random() - 0.5) * STEP_Y * 0.32;
    nodes.push({ id: idAt(r, c), r, c, x: MARGIN + c * STEP_X + jx, y: MARGIN + r * STEP_Y + jy, type: 'normal' });
  }
  // Candidate edges: orthogonal + downward diagonals (planar-ish).
  const cand = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c + 1 < cols) cand.push([idAt(r, c), idAt(r, c + 1)]);
    if (r + 1 < rows) cand.push([idAt(r, c), idAt(r + 1, c)]);
    if (r + 1 < rows && c + 1 < cols) cand.push([idAt(r, c), idAt(r + 1, c + 1)]);
    if (r + 1 < rows && c - 1 >= 0) cand.push([idAt(r, c), idAt(r + 1, c - 1)]);
  }
  shuffle(cand);
  const adj = new Map(nodes.map(n => [n.id, new Set()]));
  const parent = nodes.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const link = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };
  // Random spanning tree.
  for (const [a, b] of cand) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; link(a, b); } }
  // Extra loop edges (~28% of leftovers) for junctions.
  for (const [a, b] of cand) { if (!adj.get(a).has(b) && Math.random() < 0.28) link(a, b); }
  return { nodes, adj };
}

function bfsDist(state, from) {
  const dist = new Map([[from, 0]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const n of frontier) for (const nb of neighborsOf(state, n)) {
      if (!dist.has(nb)) { dist.set(nb, dist.get(n) + 1); next.push(nb); }
    }
    frontier = next;
  }
  return dist;
}

function generate() {
  const skill = _opts.skill, diff = _opts.difficulty;
  const cols = 4 + Math.floor(diff / 3);               // 4..6
  const rows = 4 + Math.floor((diff + 1) / 3);         // 4..6
  const sensor = 1 + Math.floor(skill / 3);            // 1..4 (graph hops)
  const alarms = 1 + Math.floor(skill / 4);            // 1..3 ICE hits tolerated
  const iceFrac = 0.14 + diff * 0.03;                  // share of nodes that are ICE
  const wantGate = diff >= 5;

  for (let attempt = 0; attempt < 120; attempt++) {
    const g = buildGraph(cols, rows);
    const state = { ...g, cols, rows, sensor, entry: null, core: null };
    // Entry bottom-left, core top-right — far apart.
    state.entry = idxWith(g.nodes, (rows - 1), 0);
    state.core = idxWith(g.nodes, 0, (cols - 1));
    g.nodes[state.entry].type = 'entry';
    g.nodes[state.core].type = 'core';

    const total = g.nodes.length;
    // Decay ICE as retries climb so a very dense board always eventually yields a
    // solvable layout rather than exhausting the attempt budget.
    const iceCount = Math.max(1, Math.round((total - 2) * iceFrac) - Math.floor(attempt / 20));
    const pool = g.nodes.filter(n => n.type === 'normal').map(n => n.id);
    shuffle(pool);

    // Place firewalls.
    for (let i = 0; i < iceCount && pool.length; i++) g.nodes[pool.pop()].type = 'firewall';
    // Optional gate + key at higher difficulty.
    let keyBitNext = 1;
    if (wantGate && pool.length >= 2) {
      const gateId = pool.pop(), keyId = pool.pop();
      g.nodes[gateId].type = 'gate'; g.nodes[gateId].gateBit = keyBitNext;
      g.nodes[keyId].type = 'key'; g.nodes[keyId].keyBit = keyBitNext;
      keyBitNext <<= 1;
    }
    // Boosts (help only — never a solvability risk).
    const boosts = 1 + Math.floor(diff / 4);
    for (let i = 0; i < boosts && pool.length; i++) g.nodes[pool.pop()].type = 'boost';

    const min = minSafeMoves(state);
    if (!isFinite(min)) continue;                       // unsolvable placement — retry

    const slack = Math.max(2, Math.ceil(min * 0.5) + skill - Math.floor(diff / 2));
    state.movesMax = min + slack;
    state.movesLeft = state.movesMax;
    state.alarmsMax = alarms; state.alarmsLeft = alarms;
    state.pos = state.entry;
    state.keys = 0;
    state.visited = new Set([state.entry]);
    state.seen = new Set();                              // firewalls the sensor has revealed
    state.traveled = new Set();                          // "a-b" edge keys already walked
    state.lastEdge = null;
    state.over = false; state.won = false;
    state.moveTick = 0;
    sense(state);
    return state;
  }
  return null;
}
function idxWith(nodes, r, c) { const n = nodes.find(x => x.r === r && x.c === c); return n ? n.id : 0; }

// Reveal firewalls within `sensor` graph-hops of the current position.
function sense(state) {
  const dist = new Map([[state.pos, 0]]);
  let frontier = [state.pos];
  while (frontier.length) {
    const next = [];
    for (const n of frontier) {
      if (dist.get(n) >= state.sensor) continue;
      for (const nb of neighborsOf(state, n)) if (!dist.has(nb)) {
        dist.set(nb, dist.get(n) + 1);
        if (state.nodes[nb].type === 'firewall') state.seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
}

// ── Interaction ───────────────────────────────────────────────────────────────
function isReachable(state, id) {
  if (state.over) return false;
  if (!neighborsOf(state, state.pos).has(id)) return false;
  const node = state.nodes[id];
  if (node.type === 'gate' && !(state.keys & node.gateBit)) return false; // locked
  return true;
}

function moveTo(state, id) {
  if (!isReachable(state, id)) return;
  const from = state.pos;
  state.pos = id;
  state.movesLeft--;
  state.visited.add(id);
  state.traveled.add(edgeKey(from, id));
  state.lastEdge = { a: state.nodes[from], b: state.nodes[id] };
  state.moveTick++;
  const node = state.nodes[id];

  if (node.type === 'firewall') {
    state.seen.add(id);
    state.alarmsLeft--;
    state.movesLeft--;                                  // ICE also burns an extra move
    sfx(SFX_ALARM);
    if (state.alarmsLeft <= 0) return finish(state, false, 'ICE LOCK — CONNECTION BURNED');
    flashStatus(`<span class="ch-warn">&#9888; ALARM TRIPPED &mdash; ${state.alarmsLeft} tolerance left</span>`);
  } else if (node.type === 'key') {
    state.keys |= node.keyBit; node.type = 'normal';    // consumed
    sfx(SFX_BOOST);
    flashStatus('<span class="ch-warn">&#9670; CIPHER KEY ACQUIRED</span>');
  } else if (node.type === 'boost') {
    state.movesLeft += 3; node.type = 'normal';
    sfx(SFX_BOOST);
    flashStatus('<span class="ch-warn">&#43; CYCLES RECOVERED (+3 moves)</span>');
  } else if (id === state.core) {
    return finish(state, true, 'CORE BREACHED — ACCESS GRANTED');
  } else {
    sfx(SFX_MOVE);
    flashStatus('');
  }

  if (!state.over && state.movesLeft <= 0) return finish(state, false, 'TRACE EXPIRED — KICKED FROM SYSTEM');
  sense(state);
  renderBoard();
  renderHud();
}
const edgeKey = (a, b) => a < b ? a + '-' + b : b + '-' + a;

function finish(state, won, text) {
  state.over = true; state.won = won;
  // Reveal all ICE on resolution.
  for (const n of state.nodes) if (n.type === 'firewall') state.seen.add(n.id);
  sfx(won ? SFX_WIN : SFX_LOSE);
  renderBoard();
  renderHud();
  const cls = won ? 'ch-win' : 'ch-lose';
  const tail = won && _opts.cashStock ? ` &mdash; &#8355; ${Number(_opts.cashStock).toLocaleString()} SIPHONED` : '';
  setStatus(`<span class="${cls}">&gt;&gt; ${text}${tail}</span>`);
  try { _opts.onResult && _opts.onResult({ won }); } catch { /* ignore */ }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function boardDims(state) {
  return { w: MARGIN * 2 + (state.cols - 1) * STEP_X, h: MARGIN * 2 + (state.rows - 1) * STEP_Y };
}

function traceSvg(state) {
  const seen = new Set();
  let out = '';
  for (const n of state.nodes) for (const nbId of neighborsOf(state, n.id)) {
    const k = edgeKey(n.id, nbId);
    if (seen.has(k)) continue; seen.add(k);
    const b = state.nodes[nbId];
    const live = state.traveled.has(k);
    const cls = live ? 'trace-live' : '';
    const stroke = live ? '#37f5db' : '#123a38';
    const dash = live ? 'stroke-dasharray="6 6"' : '';
    out += `<line x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${stroke}" stroke-width="${live ? 2.4 : 1.6}" ${dash} class="${cls}" opacity="${live ? 0.95 : 0.6}"/>`;
  }
  return out;
}

function nodeSvg(state, n) {
  const reach = isReachable(state, n.id);
  const isPos = n.id === state.pos;
  const revealedIce = n.type === 'firewall' && state.seen.has(n.id);
  const g = [];
  // reachable pulse ring
  if (reach) g.push(`<circle class="ch-reachring" cx="${n.x}" cy="${n.y}" r="20" fill="none" stroke="#8ffbec" stroke-width="1.4"/>`);

  if (n.type === 'core') {
    g.push(`<circle class="ch-coreglow" cx="${n.x}" cy="${n.y}" r="20" fill="#37f5db" opacity="0.4"/>`);
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="14" fill="#06201e" stroke="#37f5db" stroke-width="2"/>`);
    g.push(`<rect x="${n.x - 5}" y="${n.y - 5}" width="10" height="10" fill="#37f5db"/>`);
    g.push(label(n, 'CORE', '#8ffbec'));
  } else if (n.type === 'entry') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#20160a" stroke="#ffb23e" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="15" fill="#ffb23e" font-weight="bold">&#9672;</text>`);
    g.push(label(n, 'ENTRY', '#ffb23e'));
  } else if (revealedIce) {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#230b0e" stroke="#ff4a5b" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="14" fill="#ff4a5b" font-weight="bold">&#10006;</text>`);
    g.push(label(n, 'ICE', '#ff6a78'));
  } else if (n.type === 'gate') {
    const open = !!(state.keys & n.gateBit);
    const col = open ? '#46e05a' : '#ffb23e';
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#1a1608" stroke="${col}" stroke-width="2" stroke-dasharray="${open ? '0' : '4 3'}"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13" fill="${col}">${open ? '&#128275;' : '&#128274;'}</text>`);
    g.push(label(n, open ? 'OPEN' : 'GATE', col));
  } else if (n.type === 'key') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="12" fill="#1a1608" stroke="#ffd75f" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13" fill="#ffd75f">&#9919;</text>`);
    g.push(label(n, 'KEY', '#ffd75f'));
  } else if (n.type === 'boost') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="12" fill="#08210f" stroke="#46e05a" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="16" fill="#46e05a" font-weight="bold">+</text>`);
    g.push(label(n, 'BOOST', '#46e05a'));
  } else {
    // normal / unrevealed-ice both render as a neutral via (the gamble).
    const visited = state.visited.has(n.id);
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="9" fill="${visited ? '#0c1e1d' : '#0a1516'}" stroke="${visited ? '#2b4a48' : '#1d4a48'}" stroke-width="1.6"/>`);
    if (visited) g.push(`<circle cx="${n.x}" cy="${n.y}" r="3" fill="#2b4a48"/>`);
  }

  // Current-position reticle over whatever node type we're on.
  if (isPos) {
    g.push(`<g class="ch-me"><circle cx="${n.x}" cy="${n.y}" r="19" fill="none" stroke="#8ffbec" stroke-width="1.6"/>` +
      `<path d="M${n.x - 22},${n.y} h8 M${n.x + 14},${n.y} h8 M${n.x},${n.y - 22} v8 M${n.x},${n.y + 14} v8" stroke="#8ffbec" stroke-width="1.6"/></g>`);
  }
  // Invisible fat hit-target for reachable nodes (easy clicking).
  const hit = reach ? `<circle class="n-hit" cx="${n.x}" cy="${n.y}" r="22" fill="transparent" stroke="transparent" stroke-width="2"/>` : '';
  const wrap = reach ? `<g class="n-reach" data-node="${n.id}">${hit}${g.join('')}</g>` : `<g>${g.join('')}</g>`;
  return wrap;
}
function label(n, text, color) {
  return `<text x="${n.x}" y="${n.y + 27}" text-anchor="middle" font-size="8" letter-spacing="1" fill="${color}" opacity="0.85">${text}</text>`;
}

function packetSvg(state) {
  if (!state.lastEdge) return '';
  const { a, b } = state.lastEdge;
  // keyed by moveTick so a fresh animateMotion runs each move
  return `<circle r="4" fill="#8ffbec" opacity="0.95">
    <animate attributeName="opacity" values="0.95;0.95;0" dur="0.34s" begin="0s" fill="freeze"/>
    <animateMotion dur="0.28s" begin="0s" fill="freeze" path="M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}"/>
  </circle>`;
}

function boardSvg(state) {
  const { w, h } = boardDims(state);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="'Courier New',monospace">
    <defs>
      <pattern id="ch-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24,0 H0 V24" fill="none" stroke="#0c1e1d" stroke-width="1"/></pattern>
      <radialGradient id="ch-vign" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#ch-grid)"/>
    <g>${traceSvg(state)}</g>
    <g>${state.nodes.map(n => nodeSvg(state, n)).join('')}</g>
    <g>${packetSvg(state)}</g>
    <rect width="${w}" height="${h}" fill="url(#ch-vign)" pointer-events="none"/>
  </svg>`;
}

function renderBoard() {
  const el = document.getElementById('ch-board');
  if (!el) return;
  el.innerHTML = boardSvg(_state);
  el.querySelectorAll('[data-node]').forEach(g => {
    g.addEventListener('click', () => moveTo(_state, parseInt(g.getAttribute('data-node'), 10)));
  });
}
function renderHud() {
  const el = document.getElementById('ch-hud');
  if (!el) return;
  const s = _state;
  const mv = s.movesLeft <= 2 ? '#ff4a5b' : s.movesLeft <= 4 ? '#ffb23e' : '#37f5db';
  el.innerHTML =
    `<span>MOVES <b class="hv-moves" style="color:${mv}">${Math.max(0, s.movesLeft)}</b>/<span style="opacity:.6">${s.movesMax}</span></span>` +
    `<span>ALARM TOLERANCE <b class="hv-alarm">${'&#9670;'.repeat(Math.max(0, s.alarmsLeft))}${'&#9671;'.repeat(s.alarmsMax - Math.max(0, s.alarmsLeft))}</b></span>` +
    `<span>SENSOR <b class="hv-sensor">r${s.sensor}</b></span>` +
    (s.keys ? `<span style="color:#ffd75f">&#9919; KEY</span>` : '');
}
function setStatus(html) { const el = document.getElementById('ch-status'); if (el) el.innerHTML = html; }
function flashStatus(html) { setStatus(html); }

// ── Public API ────────────────────────────────────────────────────────────────
function newPuzzle() {
  _state = generate();
  if (!_state) { setStatus('<span class="ch-lose">generation failed</span>'); return; }
  renderBoard(); renderHud(); setStatus('<span style="color:#6f8792">Route to the CORE. Watch for ICE.</span>');
}

export function openCircuitHack(opts = {}) {
  ensureStyles();
  close();
  _opts = { skill: 4, difficulty: 4, cashStock: 0, atmName: 'TERMINAL', onResult: null, ...opts };
  const overlay = document.createElement('div');
  overlay.id = 'circuit-hack-overlay';
  overlay.innerHTML =
    `<div class="ch-panel">
      <button class="ch-close" title="Abort">&#10005;</button>
      <div class="ch-titlebar"><span>&#9702; CIRCUIT BREACH // INTRUSION</span><span class="ch-target">TARGET: ${esc(_opts.atmName).toUpperCase()}</span></div>
      <div class="ch-hud" id="ch-hud"></div>
      <div class="ch-board" id="ch-board"></div>
      <div class="ch-status" id="ch-status"></div>
      <div class="ch-actions">
        <button class="ch-btn ch-btn-rejack">&#8635; Re-Jack</button>
        <button class="ch-btn ch-btn-abort">Abort</button>
      </div>
    </div>`;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.ch-close').addEventListener('click', close);
  overlay.querySelector('.ch-btn-abort').addEventListener('click', close);
  overlay.querySelector('.ch-btn-rejack').addEventListener('click', () => { window.AudioEngine?.init?.(); newPuzzle(); });
  _keyHandler = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', _keyHandler);
  document.body.appendChild(overlay);
  _overlay = overlay;
  window.AudioEngine?.init?.();
  newPuzzle();
}

function close() {
  if (_keyHandler) { window.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _state = null;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
