// CIRCUIT BREACH — a node-graph hacking minigame rendered as a glowing cyberpunk
// PCB. You start at the ENTRY via and hop node→node along conductive traces to
// reach the CORE within a limited move budget. FIREWALL (ICE) and DECOY nodes
// are hidden — indistinguishable from a plain via — until your skill-scaled
// sensor or a SCAN reveals them. GATE vias are locked until you've collected
// their KEY (or forced). SENTRY vias are always visible active guards that
// block passage until DISABLED. BOOST vias refund moves.
//
// A cosmetic breach overlay launched from the ATM JACK button (see panels/atm.js)
// and from `hijack` (see plugins/surveillance/index.js via dispatch.js's
// `circuit_hack` route). The win/lose result is reported via opts.onResult; the
// caller fires the real server-side command (`jack` / `hijackresolve`), which is
// authoritative for the outcome — the real hacking skillCheck decides the
// payout. Both callers pass the ATM/device's real hack_difficulty and the
// player's real effective hacking skill, and the board weighs both heavily:
// the gap between them (`edge = skill - difficulty`) drives grid size, hazard
// density, sensor range, alarm tolerance, spare moves, and the TRACE meter
// below — an outclassed player faces a genuinely brutal board, not a cosmetic
// difference.
//
// Generation is verified solvable before display: a hazard-free (no firewall,
// sentry, or decoy), gate-respecting route to the core within the move budget
// always exists (state-space BFS over (node, keysHeld)) — the puzzle is always
// fair with perfect information, even though the player never has perfect
// information up front.
//
// TRACE is a second, global fail condition alongside moves and alarm tolerance:
// it fills every move (faster the more outclassed you are) and represents an
// active intrusion-detection system homing in on you. Filling it ends the run
// exactly like running out of cycles or alarm tolerance does.
//
// Beyond plain node-to-node movement, three extra actions add real tactical
// choice: PING (spend a cycle to pulse the sensor further out and reveal more
// hazards without advancing), SCAN (spend a cycle to positively identify one
// adjacent unknown via without moving onto it), and BREACH (spend cycles on a
// skill-weighted attempt to force a locked GATE, neutralize an adjacent
// FIREWALL without stepping on it, or disable an adjacent SENTRY — success
// isn't guaranteed and failure costs alarm tolerance + extra TRACE).

const ri = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Layout constants (SVG user units).
const STEP_X = 120, STEP_Y = 96, MARGIN = 74;

let _overlay = null;
let _keyHandler = null;
let _state = null;
let _opts = null;
let _actionMode = null; // null | 'breach' | 'scan'

// ── Audio ─────────────────────────────────────────────────────────────────
// Tiny inline SFX through the shared engine's SFX bus — same self-owned-synth
// pattern as client/game/js/poker-sfx.js. All guarded — silent if the engine
// hasn't initialised. Deliberately styled after the DB's `cyberpunk` sfx
// category (square/triangle carriers, bandpass sweeps, tremolo) rather than
// reusing the generic melodic fanfare other minigames use for "you win", so a
// breach doesn't sound like a poker hand or a level-up chime.
function sfx(def) { try { window.AudioEngine?.playSfx(def); } catch { /* no audio */ } }

const SFX_ENTRY = { priority: 4, config: { duration: 0.5, layers: [
  { waveform: 'triangle', freq: 90, pitchBend: { to: 480, time: 0.4 }, filter: { type: 'lowpass', freq: 2400, q: 1 }, adsr: { a: 0.02, d: 0.25, s: 0.3, r: 0.15 }, gain: 0.2 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3000, q: 0.8 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.04 }, gain: 0.12 },
] } };
const SFX_MOVE  = { priority: 5, config: { duration: 0.05, layers: [ { waveform: 'square', freq: 620, adsr: { a: 0.002, d: 0.04, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 640, q: 4 }, gain: 0.16 } ] } };
const SFX_BOOST = { priority: 5, config: { duration: 0.16, layers: [ { waveform: 'square', freq: 740, pitchBend: { to: 1180, time: 0.12 }, adsr: { a: 0.003, d: 0.12, s: 0.1, r: 0.05 }, filter: { type: 'bandpass', freq: 1000, q: 3 }, gain: 0.16 } ] } };
const SFX_ALARM = { priority: 6, config: { duration: 0.4, layers: [
  { waveform: 'sawtooth', freq: 300, pitchBend: { to: 90, time: 0.35 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.005, d: 0.2, s: 0.3, r: 0.3 }, gain: 0.22 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 220, q: 2 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.06 }, gain: 0.5 } ] } };
// Sonar-style sweep out and back — a sensor pulse, not a move.
const SFX_PING = { priority: 6, config: { duration: 0.5, layers: [
  { waveform: 'sine', freq: 520, pitchBend: { to: 1400, time: 0.22 }, adsr: { a: 0.01, d: 0.2, s: 0.2, r: 0.2 }, gain: 0.22 },
  { waveform: 'sine', freq: 1400, delay: 0.22, pitchBend: { to: 520, time: 0.24 }, adsr: { a: 0.01, d: 0.22, s: 0, r: 0.15 }, gain: 0.14 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2200, q: 3 }, adsr: { a: 0.002, d: 0.06, s: 0, r: 0.04 }, gain: 0.1 },
] } };
// A heavy mechanical clunk + crack — brute-forcing a locked gate, distinct from
// the alarm's electronic shriek (this is physical, destructive).
const SFX_FORCE = { priority: 7, config: { duration: 0.5, layers: [
  { waveform: 'triangle', freq: 90, pitchBend: { to: 40, time: 0.2 }, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.15 }, gain: 0.45 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 500, q: 1.5 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.1 }, gain: 0.4 },
  { waveform: 'noise', noiseMix: 1, delay: 0.08, filter: { type: 'highpass', freq: 3500, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.05 }, gain: 0.2 },
] } };
// ACCESS GRANTED — a clinical rising sweep into a crisp double confirmation
// chirp. Digital and terminal-flavoured (mirrors the DB's terminal_login/
// scanner cyberpunk sfx) rather than a musical major-chord fanfare.
const SFX_WIN = { priority: 8, config: { duration: 0.65, layers: [
  { waveform: 'square', freq: 380, pitchBend: { to: 1600, time: 0.22 }, filter: { type: 'lowpass', freq: 5000, q: 1 }, adsr: { a: 0.005, d: 0.18, s: 0.1, r: 0.08 }, gain: 0.18 },
  { waveform: 'square', freq: 1800, delay: 0.24, adsr: { a: 0.003, d: 0.07, s: 0, r: 0.05 }, filter: { type: 'bandpass', freq: 1800, q: 4 }, gain: 0.22 },
  { waveform: 'square', freq: 2400, delay: 0.34, adsr: { a: 0.003, d: 0.09, s: 0, r: 0.08 }, filter: { type: 'bandpass', freq: 2400, q: 5 }, gain: 0.2 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 4000, q: 0.6 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.08 },
] } };
// CONNECTION SEVERED — a digital stutter/cutout rather than a sad trombone:
// a falling sub thud plus two glitch-static bursts hacking the signal apart.
const SFX_LOSE = { priority: 8, config: { duration: 0.6, layers: [
  { waveform: 'sawtooth', freq: 160, pitchBend: { to: 40, time: 0.45 }, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.01, d: 0.25, s: 0.3, r: 0.3 }, gain: 0.22 },
  { waveform: 'noise', noiseMix: 1, delay: 0.08, filter: { type: 'highpass', freq: 2800, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.3 },
  { waveform: 'noise', noiseMix: 1, delay: 0.2, filter: { type: 'highpass', freq: 2000, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.26 },
  { waveform: 'square', freq: 70, delay: 0.05, pitchBend: { to: 25, time: 0.4 }, adsr: { a: 0.01, d: 0.3, s: 0.2, r: 0.3 }, gain: 0.14 },
] } };

// ── Styles ──────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('circuit-hack-styles')) return;
  const s = document.createElement('style');
  s.id = 'circuit-hack-styles';
  s.textContent = `
    #circuit-hack-overlay { --ch-accent:#37f5db; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,4,6,0.78); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #circuit-hack-overlay .ch-panel { position:relative; width:min(760px,95vw); background:linear-gradient(160deg,#0a1a16,#07120f 70%,#050d0b);
      border:2px solid color-mix(in srgb, var(--ch-accent) 35%, #0a1a16); border-radius:8px;
      box-shadow:0 0 0 1px #000, 0 0 40px color-mix(in srgb, var(--ch-accent) 22%, transparent), inset 0 0 60px rgba(0,0,0,0.7);
      padding:12px 14px 14px; animation:ch-boot .3s ease-out;
      background-image:linear-gradient(160deg,#0a1a16,#07120f 70%,#050d0b),
        repeating-linear-gradient(90deg, #d8b46a 0 6px, transparent 6px 26px);
      background-blend-mode:normal, overlay; background-position:0 0, 0 0; background-size:auto, 26px 100%;
      background-repeat:no-repeat, repeat-x; }
    #circuit-hack-overlay .ch-panel::before, #circuit-hack-overlay .ch-panel::after {
      content:''; position:absolute; left:10px; right:10px; height:6px; pointer-events:none; opacity:0.35;
      background-image:repeating-linear-gradient(90deg, #d8b46a 0 5px, transparent 5px 22px); }
    #circuit-hack-overlay .ch-panel::before { top:0; }
    #circuit-hack-overlay .ch-panel::after { bottom:0; }
    @keyframes ch-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #circuit-hack-overlay .ch-close { position:absolute; top:9px; right:11px; z-index:3; width:26px; height:26px;
      background:#0c1a15; color:#8fbba0; border:1px solid #2b4a3c; border-radius:2px; cursor:pointer; font-size:13px; }
    #circuit-hack-overlay .ch-close:hover { color:#ff4a5b; border-color:#ff4a5b; }
    #circuit-hack-overlay .ch-titlebar { display:flex; justify-content:space-between; align-items:center;
      font-size:12px; letter-spacing:3px; color:var(--ch-accent); font-weight:bold; padding:2px 2px 8px; border-bottom:1px solid #163025; }
    #circuit-hack-overlay .ch-titlebar .ch-target { color:#7fa392; font-weight:normal; letter-spacing:1px; }
    #circuit-hack-overlay .ch-hud { display:flex; gap:16px; padding:8px 2px; font-size:12px; color:#7fa392; letter-spacing:1px; flex-wrap:wrap; }
    #circuit-hack-overlay .ch-hud b { font-weight:bold; }
    #circuit-hack-overlay .ch-hud .hv-moves { color:var(--ch-accent); }
    #circuit-hack-overlay .ch-hud .hv-alarm { color:#ffb23e; }
    #circuit-hack-overlay .ch-hud .hv-sensor { color:#8fbba0; }
    #circuit-hack-overlay .ch-trace-wrap { display:inline-flex; align-items:center; gap:6px; }
    #circuit-hack-overlay .ch-trace-bar { display:inline-block; width:64px; height:7px; background:#0c1a17; border:1px solid #2b4a3c; border-radius:3px; overflow:hidden; }
    #circuit-hack-overlay .ch-trace-fill { display:block; height:100%; transition:width .15s, background .15s; }
    #circuit-hack-overlay .ch-board { background:#051310; border:1px solid #163025; border-radius:4px; overflow:hidden; }
    #circuit-hack-overlay .ch-status { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #circuit-hack-overlay .ch-status .ch-win { color:#46e05a; }
    #circuit-hack-overlay .ch-status .ch-lose { color:#ff4a5b; }
    #circuit-hack-overlay .ch-status .ch-warn { color:#ffb23e; }
    #circuit-hack-overlay .ch-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
    #circuit-hack-overlay .ch-btn { flex:1; min-width:88px; padding:9px 6px; background:#0c1a15; color:#8fbba0; border:1px solid #2b4a3c;
      border-radius:2px; cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; }
    #circuit-hack-overlay .ch-btn:hover { transform:translateY(1px); box-shadow:inset 0 -1px 0 rgba(0,0,0,0.5); color:#4dffb0; border-color:#4dffb0; }
    #circuit-hack-overlay .ch-btn-abort:hover { color:#ff4a5b; border-color:#ff4a5b; }
    #circuit-hack-overlay .ch-btn-breach:hover { color:#ffb23e; border-color:#ffb23e; }
    #circuit-hack-overlay .ch-btn-scan:hover { color:#8fbba0; border-color:#8fbba0; }
    #circuit-hack-overlay .ch-btn-active { color:#0a1a16; background:#ffb23e; border-color:#ffb23e; }
    /* SVG element classes */
    #circuit-hack-overlay .n-reach { cursor:pointer; }
    #circuit-hack-overlay .n-reach:hover .n-hit { stroke:var(--ch-accent); }
    #circuit-hack-overlay .n-force:hover .n-hit { stroke:#ffb23e; }
    @keyframes ch-flow { to { stroke-dashoffset:-20; } }
    #circuit-hack-overlay .trace-live { animation:ch-flow 1s linear infinite; }
    @keyframes ch-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
    #circuit-hack-overlay .ch-reachring { animation:ch-pulse 1.1s infinite; }
    @keyframes ch-forcering { 0%,100%{opacity:.3;stroke-width:1.2} 50%{opacity:.9;stroke-width:2} }
    #circuit-hack-overlay .ch-forcering { animation:ch-forcering 0.7s infinite; }
    #circuit-hack-overlay .ch-scanring { animation:ch-forcering 0.9s infinite; }
    @keyframes ch-corepulse { 0%,100%{r:20px;opacity:.5} 50%{r:26px;opacity:.15} }
    #circuit-hack-overlay .ch-coreglow { animation:ch-corepulse 2s infinite; }
    @keyframes ch-meflick { 0%,100%{opacity:1} 90%{opacity:1} 94%{opacity:.5} }
    #circuit-hack-overlay .ch-me { animation:ch-meflick 2.5s infinite; }
  `;
  document.head.appendChild(s);
}

// ── Generation ────────────────────────────────────────────────────────────────
function neighborsOf(state, id) { return state.adj.get(id) || new Set(); }

// Shortest hazard-free, gate-respecting route length ENTRY→CORE, or Infinity.
// State = (node, keysMask). Keys are bit positions per key node. "Hazard" =
// firewall/sentry/decoy — the guarantee is that a totally clean route exists
// with perfect information, not that every hazard is avoidable blind.
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
        if (node.type === 'firewall' || node.type === 'sentry' || node.type === 'decoy') continue; // route must avoid all hazards
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
  const skill = Math.max(0, _opts.skill);
  const diff = Math.max(1, _opts.difficulty);
  // Positive edge favors the player, negative favors the system. This single
  // number is what makes the board "significantly" harder when a player is
  // under-skilled for the target, not just cosmetically different.
  const edge = skill - diff;

  const cols = clampInt(4 + Math.floor(diff / 2), 4, 8);
  const rows = clampInt(4 + Math.floor((diff + 1) / 2), 4, 8);
  const sensor = clampInt(1 + Math.floor(skill / 3) + Math.floor(Math.min(0, edge) / 3), 0, 5);
  const alarms = clampInt(1 + Math.floor(skill / 4) + Math.floor(Math.min(0, edge) / 4), 1, 5);
  const iceFrac = clampNum(0.15 + diff * 0.032 - skill * 0.012, 0.10, 0.44);
  const wantGate = diff >= 4;
  const sentryTarget = diff >= 3 ? clampInt(1 + Math.floor(diff / 3) - Math.floor(Math.max(0, edge) / 4), 0, 5) : 0;
  const decoyTarget = clampInt(1 + Math.floor(diff / 4), 0, 4);

  for (let attempt = 0; attempt < 160; attempt++) {
    const g = buildGraph(cols, rows);
    const state = { ...g, cols, rows, sensor, entry: null, core: null };
    // Entry bottom-left, core top-right — far apart.
    state.entry = idxWith(g.nodes, (rows - 1), 0);
    state.core = idxWith(g.nodes, 0, (cols - 1));
    g.nodes[state.entry].type = 'entry';
    g.nodes[state.core].type = 'core';

    const total = g.nodes.length;
    // Decay hazard counts as retries climb so a very dense board always
    // eventually yields a solvable layout rather than exhausting the budget.
    const iceCount = Math.max(1, Math.round((total - 2) * iceFrac) - Math.floor(attempt / 20));
    const sentryCount = Math.max(0, sentryTarget - Math.floor(attempt / 15));
    const decoyCount = Math.max(0, decoyTarget - Math.floor(attempt / 25));
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
    // Sentries — active guards, always visible, block passage until disabled.
    for (let i = 0; i < sentryCount && pool.length; i++) {
      const n = g.nodes[pool.pop()];
      n.type = 'sentry';
      n.disabled = false;
    }
    // Decoys — indistinguishable from a plain via until sensed/scanned; punish
    // a blind step without tripping the alarm.
    for (let i = 0; i < decoyCount && pool.length; i++) g.nodes[pool.pop()].type = 'decoy';
    // Boosts (help only — never a solvability risk).
    const boosts = 1 + Math.floor(diff / 4);
    for (let i = 0; i < boosts && pool.length; i++) g.nodes[pool.pop()].type = 'boost';

    const min = minSafeMoves(state);
    if (!isFinite(min)) continue;                       // unsolvable placement — retry

    // Spare-move slack shrinks as difficulty climbs and grows/shrinks further
    // with edge — an outclassed player gets a genuinely tight budget.
    const slackFrac = clampNum(0.62 - diff * 0.02, 0.3, 0.62);
    const slack = clampInt(Math.ceil(min * slackFrac) + Math.floor(edge / 2), 2, 24);
    state.movesMax = min + slack;
    state.movesLeft = state.movesMax;
    state.alarmsMax = alarms; state.alarmsLeft = alarms;
    // TRACE — a second, global fail condition. Fills every move/scan/ping;
    // faster the more outclassed the player is. Represents an active IDS
    // homing in on the intrusion rather than a single passive trap.
    state.traceRate = clampNum(0.7 + diff * 0.32 - skill * 0.2, 0.3, 3.2);
    state.traceMax = clampInt(11 + skill * 1.4 - diff * 0.9, 6, 22);
    state.trace = 0;
    state.pos = state.entry;
    state.keys = 0;
    state.visited = new Set([state.entry]);
    state.identified = new Set();                        // hidden firewalls/decoys the player has confirmed
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

// Reveal hidden hazards (firewall/decoy) within `radius` graph-hops of the
// current position (defaults to the puzzle's base sensor range; PING calls
// this with a boosted radius). Sentries are always visible — nothing to reveal.
function sense(state, radius = state.sensor) {
  const dist = new Map([[state.pos, 0]]);
  let frontier = [state.pos];
  while (frontier.length) {
    const next = [];
    for (const n of frontier) {
      if (dist.get(n) >= radius) continue;
      for (const nb of neighborsOf(state, n)) if (!dist.has(nb)) {
        dist.set(nb, dist.get(n) + 1);
        const t = state.nodes[nb].type;
        if (t === 'firewall' || t === 'decoy') state.identified.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
}

// Is this node's true nature known to the player (sensed/scanned/visited), or
// does it still render as an indistinguishable neutral via?
function isKnown(state, id) {
  const n = state.nodes[id];
  if (n.type !== 'firewall' && n.type !== 'decoy') return true; // never hidden
  return state.identified.has(id) || state.visited.has(id);
}

// Skill-vs-difficulty win chance for a BREACH attempt, clamped so neither side
// is ever a sure thing.
const BREACH_BASE = { gate: 0.55, firewall: 0.42, sentry: 0.3 };
function breachChance(kind) {
  return clampNum(BREACH_BASE[kind] + (_opts.skill - _opts.difficulty) * 0.07, 0.08, 0.95);
}

// ── Interaction ───────────────────────────────────────────────────────────────
function isReachable(state, id) {
  if (state.over) return false;
  if (!neighborsOf(state, state.pos).has(id)) return false;
  const node = state.nodes[id];
  if (node.type === 'gate' && !(state.keys & node.gateBit)) return false;       // locked
  if (node.type === 'sentry' && !node.disabled) return false;                   // active guard blocks passage
  return true;
}

// A locked GATE, an active SENTRY, or a FIREWALL adjacent to the current
// position — none can be safely walked onto (well, firewall can, but at a
// cost), all three can instead be targeted with BREACH.
function breachKind(state, id) {
  if (state.over) return null;
  if (!neighborsOf(state, state.pos).has(id)) return null;
  const node = state.nodes[id];
  if (node.type === 'gate' && !(state.keys & node.gateBit)) return 'gate';
  if (node.type === 'sentry' && !node.disabled) return 'sentry';
  if (node.type === 'firewall') return 'firewall';
  return null;
}

// Any adjacent via whose true nature (clear / firewall / decoy) isn't known
// yet — SCAN spends a cycle to positively identify it without moving onto it.
function isScannable(state, id) {
  if (state.over) return false;
  if (!neighborsOf(state, state.pos).has(id)) return false;
  return !isKnown(state, id);
}

function bumpTrace(state, amount) {
  state.trace = Math.min(state.traceMax, state.trace + amount);
}

// Shared post-action check: TRACE takes priority over running out of cycles
// since it represents actively getting caught, not just running dry.
function checkFailStates(state) {
  if (state.over) return true;
  if (state.trace >= state.traceMax) { finish(state, false, 'TRACE COMPLETE — INTRUSION LOGGED, CONNECTION SEVERED'); return true; }
  if (state.movesLeft <= 0) { finish(state, false, 'CYCLES EXHAUSTED — KICKED FROM SYSTEM'); return true; }
  return false;
}

function moveTo(state, id) {
  if (!isReachable(state, id)) return;
  const from = state.pos;
  state.pos = id;
  state.movesLeft--;
  state.visited.add(id);
  state.identified.add(id);
  state.traveled.add(edgeKey(from, id));
  state.lastEdge = { a: state.nodes[from], b: state.nodes[id] };
  state.moveTick++;
  bumpTrace(state, state.traceRate);
  const node = state.nodes[id];

  if (node.type === 'firewall') {
    state.alarmsLeft--;
    state.movesLeft--;                                  // ICE also burns an extra move
    bumpTrace(state, state.traceRate * 0.6);
    sfx(SFX_ALARM);
    if (state.alarmsLeft <= 0) return finish(state, false, 'ICE LOCK — CONNECTION BURNED');
    flashStatus(`<span class="ch-warn">&#9888; ALARM TRIPPED &mdash; ${state.alarmsLeft} tolerance left</span>`);
  } else if (node.type === 'decoy') {
    const penalty = 2 + Math.floor(_opts.difficulty / 3);
    state.movesLeft -= penalty;
    bumpTrace(state, state.traceRate * 0.4);
    node.type = 'normal';                                // sprung — inert afterward
    sfx(SFX_ALARM);
    flashStatus(`<span class="ch-warn">&#9761; SNARE TRIPPED &mdash; ${penalty} cycles drained</span>`);
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

  if (checkFailStates(state)) return;
  sense(state);
  renderBoard();
  renderHud();
}
const edgeKey = (a, b) => a < b ? a + '-' + b : b + '-' + a;

// PING — spend 1 cycle to pulse the sensor 2 hops further out without
// advancing. Trades tempo (and a little TRACE, the pulse is detectable) for
// information; useful when every neighbor looks like a gamble.
const PING_COST = 1, PING_BONUS_RADIUS = 2;
function ping(state) {
  if (state.over || state.movesLeft < PING_COST) { flashStatus('<span class="ch-warn">NOT ENOUGH CYCLES TO PING</span>'); return; }
  state.movesLeft -= PING_COST;
  bumpTrace(state, state.traceRate * 0.6);
  sense(state, state.sensor + PING_BONUS_RADIUS);
  sfx(SFX_PING);
  flashStatus('<span class="ch-warn">&#8226; SENSOR PULSE — EXTENDED RANGE</span>');
  if (checkFailStates(state)) return;
  renderBoard();
  renderHud();
}

// SCAN — spend 1 cycle to positively identify one adjacent unknown via
// (clear / firewall / decoy) without moving onto it. Always succeeds, no risk
// beyond the tiny TRACE tick, but only ever confirms — never neutralizes.
const SCAN_COST = 1;
function scanNode(state, id) {
  if (!isScannable(state, id)) return;
  if (state.movesLeft < SCAN_COST) { flashStatus('<span class="ch-warn">NOT ENOUGH CYCLES TO SCAN</span>'); return; }
  state.movesLeft -= SCAN_COST;
  bumpTrace(state, state.traceRate * 0.4);
  state.identified.add(id);
  _actionMode = null;
  const t = state.nodes[id].type;
  sfx(SFX_PING);
  flashStatus(t === 'normal'
    ? '<span style="color:#7fa392">SCAN: via clear.</span>'
    : `<span class="ch-warn">SCAN: ${t === 'firewall' ? 'ICE' : 'SNARE'} confirmed.</span>`);
  if (checkFailStates(state)) return;
  renderBoard();
  renderHud();
}

// BREACH — a skill-weighted attempt to force a locked GATE, neutralize an
// adjacent FIREWALL without stepping on it, or disable an adjacent SENTRY.
// Unlike SCAN, success isn't guaranteed: failure still costs the cycles and
// additionally costs alarm tolerance + extra TRACE (the attempt trips
// sensors a clean route wouldn't), but the node can be re-targeted if
// resources remain.
const BREACH_MOVE_COST = { gate: 3, firewall: 2, sentry: 4 };
const BREACH_FAIL_ALARM = { gate: 1, firewall: 1, sentry: 2 };
const BREACH_LABEL = { gate: 'GATE', firewall: 'ICE', sentry: 'SENTRY' };
function breach(state, id) {
  const kind = breachKind(state, id);
  if (!kind) return;
  const cost = BREACH_MOVE_COST[kind];
  if (state.movesLeft < cost) { flashStatus('<span class="ch-warn">NOT ENOUGH CYCLES TO BREACH</span>'); return; }
  state.movesLeft -= cost;
  const chance = breachChance(kind);
  const success = Math.random() < chance;
  bumpTrace(state, state.traceRate * (success ? 0.6 : 1.3));
  _actionMode = null;
  if (success) {
    if (kind === 'gate') state.keys |= state.nodes[id].gateBit;
    else if (kind === 'firewall') { state.nodes[id].type = 'normal'; state.identified.add(id); }
    else if (kind === 'sentry') state.nodes[id].disabled = true;
    sfx(SFX_FORCE);
    flashStatus(`<span class="ch-warn">&#128163; ${BREACH_LABEL[kind]} BREACHED</span>`);
  } else {
    state.alarmsLeft -= BREACH_FAIL_ALARM[kind];
    if (kind === 'firewall') state.identified.add(id);   // failed attempt reveals it for certain
    sfx(SFX_ALARM);
    if (state.alarmsLeft <= 0) return finish(state, false, 'ICE LOCK — CONNECTION BURNED');
    flashStatus(`<span class="ch-warn">&#9888; BREACH FAILED &mdash; ${state.alarmsLeft} tolerance left</span>`);
  }
  if (checkFailStates(state)) return;
  sense(state);
  renderBoard();
  renderHud();
}

function finish(state, won, text) {
  state.over = true; state.won = won;
  // Reveal all hazards on resolution.
  for (const n of state.nodes) if (n.type === 'firewall' || n.type === 'decoy') state.identified.add(n.id);
  sfx(won ? SFX_WIN : SFX_LOSE);
  renderBoard();
  renderHud();
  const cls = won ? 'ch-win' : 'ch-lose';
  setStatus(`<span class="${cls}">&gt;&gt; ${text}</span>`);
  try { _opts.onResult && _opts.onResult({ won }); } catch { /* ignore */ }
  // On a win the real outcome is reported server-side (see onResult); the
  // overlay's job is done, so close it rather than leaving it sitting open.
  if (won) setTimeout(() => close(), 1100);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function boardDims(state) {
  return { w: MARGIN * 2 + (state.cols - 1) * STEP_X, h: MARGIN * 2 + (state.rows - 1) * STEP_Y };
}

// Decorative copper trace veins behind the puzzle graph — right-angle PCB-style
// segments and via pads, purely cosmetic (not the interactive node graph).
function pcbDecorSvg(w, h) {
  const segs = [];
  const cellsX = Math.ceil(w / 60), cellsY = Math.ceil(h / 60);
  for (let i = 0; i < 34; i++) {
    const x0 = ri(cellsX) * 60, y0 = ri(cellsY) * 60;
    const horizFirst = Math.random() < 0.5;
    const dx = 60, dy = 60;
    const mid = horizFirst ? `${x0 + dx},${y0}` : `${x0},${y0 + dy}`;
    segs.push(`<path d="M${x0},${y0} L${mid} L${x0 + dx},${y0 + dy}" fill="none" stroke="var(--ch-accent)" stroke-width="2"/>`);
    segs.push(`<circle cx="${x0}" cy="${y0}" r="2.2" fill="var(--ch-accent)"/>`);
  }
  // A few schematic-style IC blocks with pin stubs, purely decorative.
  for (let i = 0; i < 3; i++) {
    const x0 = ri(cellsX - 1) * 60 + 12, y0 = ri(cellsY - 1) * 60 + 12;
    const cw = 34, ch2 = 20;
    segs.push(`<rect x="${x0}" y="${y0}" width="${cw}" height="${ch2}" fill="none" stroke="var(--ch-accent)" stroke-width="1.4" opacity="0.8"/>`);
    for (let p = 0; p < 3; p++) {
      const px = x0 + 6 + p * 11;
      segs.push(`<line x1="${px}" y1="${y0}" x2="${px}" y2="${y0 - 6}" stroke="var(--ch-accent)" stroke-width="1.4"/>`);
      segs.push(`<line x1="${px}" y1="${y0 + ch2}" x2="${px}" y2="${y0 + ch2 + 6}" stroke="var(--ch-accent)" stroke-width="1.4"/>`);
    }
  }
  return `<g opacity="0.22">${segs.join('')}</g>`;
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
    const stroke = live ? 'var(--ch-accent)' : '#1b4536';
    const dash = live ? 'stroke-dasharray="6 6"' : '';
    out += `<line x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${stroke}" stroke-width="${live ? 2.4 : 1.6}" ${dash} class="${cls}" opacity="${live ? 0.95 : 0.6}"/>`;
  }
  return out;
}

function nodeSvg(state, n) {
  const reach = isReachable(state, n.id);
  const breachable = _actionMode === 'breach' && breachKind(state, n.id) != null;
  const scannable = _actionMode === 'scan' && isScannable(state, n.id);
  const isPos = n.id === state.pos;
  const known = isKnown(state, n.id);
  const g = [];
  // reachable / targetable pulse rings
  if (reach) g.push(`<circle class="ch-reachring" cx="${n.x}" cy="${n.y}" r="20" fill="none" stroke="var(--ch-accent)" stroke-width="1.4"/>`);
  if (breachable) g.push(`<circle class="ch-forcering" cx="${n.x}" cy="${n.y}" r="20" fill="none" stroke="#ffb23e" stroke-width="1.6" stroke-dasharray="4 3"/>`);
  if (scannable) g.push(`<circle class="ch-scanring" cx="${n.x}" cy="${n.y}" r="20" fill="none" stroke="#8fbba0" stroke-width="1.6" stroke-dasharray="2 4"/>`);

  if (n.type === 'core') {
    g.push(`<circle class="ch-coreglow" cx="${n.x}" cy="${n.y}" r="20" fill="var(--ch-accent)" opacity="0.4"/>`);
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="14" fill="#06201e" stroke="var(--ch-accent)" stroke-width="2"/>`);
    g.push(`<rect x="${n.x - 5}" y="${n.y - 5}" width="10" height="10" fill="var(--ch-accent)"/>`);
    g.push(label(n, 'CORE', 'var(--ch-accent)'));
  } else if (n.type === 'entry') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#20160a" stroke="#ffb23e" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="15" fill="#ffb23e" font-weight="bold">&#9672;</text>`);
    g.push(label(n, 'ENTRY', '#ffb23e'));
  } else if (n.type === 'sentry') {
    const col = n.disabled ? '#46e05a' : '#ff8a3e';
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#241206" stroke="${col}" stroke-width="2" stroke-dasharray="${n.disabled ? '0' : '3 3'}"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13" fill="${col}">${n.disabled ? '&#10003;' : '&#9873;'}</text>`);
    g.push(label(n, n.disabled ? 'SENTRY (DOWN)' : 'SENTRY', col));
  } else if (known && n.type === 'firewall') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="13" fill="#230b0e" stroke="#ff4a5b" stroke-width="2"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="14" fill="#ff4a5b" font-weight="bold">&#10006;</text>`);
    g.push(label(n, 'ICE', '#ff6a78'));
  } else if (known && n.type === 'decoy') {
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="12" fill="#241a08" stroke="#ffb23e" stroke-width="2" stroke-dasharray="2 3"/>`);
    g.push(`<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13" fill="#ffb23e">&#9761;</text>`);
    g.push(label(n, 'SNARE', '#ffb23e'));
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
    // normal / unidentified firewall / unidentified decoy all render as an
    // indistinguishable neutral via (the gamble) until sensed or scanned.
    const visited = state.visited.has(n.id);
    g.push(`<circle cx="${n.x}" cy="${n.y}" r="9" fill="${visited ? '#0c1e1d' : '#0a1516'}" stroke="${visited ? '#2b4a48' : '#1d4a48'}" stroke-width="1.6"/>`);
    if (visited) g.push(`<circle cx="${n.x}" cy="${n.y}" r="3" fill="#2b4a48"/>`);
  }

  // Current-position reticle over whatever node type we're on.
  if (isPos) {
    g.push(`<g class="ch-me"><circle cx="${n.x}" cy="${n.y}" r="19" fill="none" stroke="var(--ch-accent)" stroke-width="1.6"/>` +
      `<path d="M${n.x - 22},${n.y} h8 M${n.x + 14},${n.y} h8 M${n.x},${n.y - 22} v8 M${n.x},${n.y + 14} v8" stroke="var(--ch-accent)" stroke-width="1.6"/></g>`);
  }
  // Invisible fat hit-target for reachable/breachable/scannable nodes.
  const clickable = reach || breachable || scannable;
  const hit = clickable ? `<circle class="n-hit" cx="${n.x}" cy="${n.y}" r="22" fill="transparent" stroke="transparent" stroke-width="2"/>` : '';
  const kind = scannable ? 'scan' : breachable ? 'breach' : reach ? 'move' : '';
  const cls = kind === 'move' ? 'n-reach' : kind ? 'n-reach n-force' : '';
  const wrap = clickable ? `<g class="${cls}" data-node="${n.id}" data-kind="${kind}">${hit}${g.join('')}</g>` : `<g>${g.join('')}</g>`;
  return wrap;
}
function label(n, text, color) {
  return `<text x="${n.x}" y="${n.y + 27}" text-anchor="middle" font-size="8" letter-spacing="1" fill="${color}" opacity="0.85">${text}</text>`;
}

function packetSvg(state) {
  if (!state.lastEdge) return '';
  const { a, b } = state.lastEdge;
  // keyed by moveTick so a fresh animateMotion runs each move
  return `<circle r="4" fill="var(--ch-accent)" opacity="0.95">
    <animate attributeName="opacity" values="0.95;0.95;0" dur="0.34s" begin="0s" fill="freeze"/>
    <animateMotion dur="0.28s" begin="0s" fill="freeze" path="M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}"/>
  </circle>`;
}

function boardSvg(state) {
  const { w, h } = boardDims(state);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="'Courier New',monospace">
    <defs>
      <pattern id="ch-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24,0 H0 V24" fill="none" stroke="#0e241c" stroke-width="1"/></pattern>
      <radialGradient id="ch-vign" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient>
      <radialGradient id="ch-board-tint" cx="50%" cy="40%" r="75%"><stop offset="0%" stop-color="color-mix(in srgb, var(--ch-accent) 20%, #051310)"/><stop offset="100%" stop-color="#051310"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#ch-board-tint)"/>
    <rect width="${w}" height="${h}" fill="url(#ch-grid)"/>
    ${pcbDecorSvg(w, h)}
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
    const id = parseInt(g.getAttribute('data-node'), 10);
    const kind = g.getAttribute('data-kind');
    g.addEventListener('click', () => {
      if (kind === 'scan') scanNode(_state, id);
      else if (kind === 'breach') breach(_state, id);
      else moveTo(_state, id);
    });
  });
}
function renderHud() {
  const el = document.getElementById('ch-hud');
  if (!el) return;
  const s = _state;
  const mv = s.movesLeft <= 2 ? '#ff4a5b' : s.movesLeft <= 4 ? '#ffb23e' : '#4dffb0';
  const tracePct = Math.round((s.trace / s.traceMax) * 100);
  const traceCol = tracePct >= 75 ? '#ff4a5b' : tracePct >= 40 ? '#ffb23e' : '#8fbba0';
  el.innerHTML =
    `<span>CYCLES <b class="hv-moves" style="color:${mv}">${Math.max(0, s.movesLeft)}</b>/<span style="opacity:.6">${s.movesMax}</span></span>` +
    `<span>ALARM TOLERANCE <b class="hv-alarm">${'&#9670;'.repeat(Math.max(0, s.alarmsLeft))}${'&#9671;'.repeat(s.alarmsMax - Math.max(0, s.alarmsLeft))}</b></span>` +
    `<span>SENSOR <b class="hv-sensor">r${s.sensor}</b></span>` +
    `<span class="ch-trace-wrap">TRACE <span class="ch-trace-bar"><span class="ch-trace-fill" style="width:${tracePct}%;background:${traceCol}"></span></span></span>` +
    (s.keys ? `<span style="color:#ffd75f">&#9919; KEY</span>` : '');
}
function setStatus(html) { const el = document.getElementById('ch-status'); if (el) el.innerHTML = html; }
function flashStatus(html) { setStatus(html); }

// ── Public API ────────────────────────────────────────────────────────────────
function newPuzzle() {
  _actionMode = null;
  _state = generate();
  if (!_state) { setStatus('<span class="ch-lose">generation failed</span>'); return; }
  renderBoard(); renderHud(); setStatus('<span style="color:#7fa392">Route to the CORE. PING/SCAN to scout, BREACH to force a GATE/ICE/SENTRY. Watch the TRACE meter.</span>');
}

export function openCircuitHack(opts = {}) {
  ensureStyles();
  close();
  _opts = { skill: 4, difficulty: 4, atmName: 'TERMINAL', accent: '#37f5db', onResult: null, ...opts };
  const overlay = document.createElement('div');
  overlay.id = 'circuit-hack-overlay';
  overlay.style.setProperty('--ch-accent', _opts.accent);
  overlay.innerHTML =
    `<div class="ch-panel">
      <button class="ch-close" title="Abort">&#10005;</button>
      <div class="ch-titlebar"><span>&#9702; CIRCUIT BREACH // INTRUSION</span><span class="ch-target">TARGET: ${esc(_opts.atmName).toUpperCase()}</span></div>
      <div class="ch-hud" id="ch-hud"></div>
      <div class="ch-board" id="ch-board"></div>
      <div class="ch-status" id="ch-status"></div>
      <div class="ch-actions">
        <button class="ch-btn ch-btn-ping" title="Spend 1 cycle to extend your sensor range without moving">&#8226; Ping</button>
        <button class="ch-btn ch-btn-scan" title="Spend 1 cycle to identify one adjacent unknown via without moving onto it">&#9678; Scan</button>
        <button class="ch-btn ch-btn-breach" title="Skill-weighted attempt to force a locked GATE, neutralize an adjacent ICE, or disable an adjacent SENTRY">&#128163; Breach</button>
        <button class="ch-btn ch-btn-rejack">&#8635; Re-Jack</button>
        <button class="ch-btn ch-btn-abort">Abort</button>
      </div>
    </div>`;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.ch-close').addEventListener('click', close);
  overlay.querySelector('.ch-btn-abort').addEventListener('click', close);
  overlay.querySelector('.ch-btn-rejack').addEventListener('click', () => { window.AudioEngine?.init?.(); newPuzzle(); });
  overlay.querySelector('.ch-btn-ping').addEventListener('click', () => { if (_state && !_state.over) ping(_state); });
  const scanBtn = overlay.querySelector('.ch-btn-scan');
  const breachBtn = overlay.querySelector('.ch-btn-breach');
  const setMode = (mode, armedMsg, disarmedMsg) => {
    if (!_state || _state.over) return;
    _actionMode = _actionMode === mode ? null : mode;
    scanBtn.classList.toggle('ch-btn-active', _actionMode === 'scan');
    breachBtn.classList.toggle('ch-btn-active', _actionMode === 'breach');
    flashStatus(_actionMode === mode ? armedMsg : disarmedMsg);
    renderBoard();
  };
  scanBtn.addEventListener('click', () => setMode('scan',
    '<span class="ch-warn">SCAN ARMED — click an adjacent unknown via</span>',
    '<span style="color:#7fa392">Scan disarmed.</span>'));
  breachBtn.addEventListener('click', () => setMode('breach',
    '<span class="ch-warn">BREACH ARMED — click an adjacent GATE, ICE, or SENTRY</span>',
    '<span style="color:#7fa392">Breach disarmed.</span>'));
  _keyHandler = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', _keyHandler);
  document.body.appendChild(overlay);
  _overlay = overlay;
  window.AudioEngine?.init?.();
  sfx(SFX_ENTRY);
  newPuzzle();
}

function close() {
  if (_keyHandler) { window.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _state = null;
  _actionMode = null;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
